# Local CONNECT proxy for git, npm, Playwright, curl, etc.
# Uses Windows DefaultNetworkCredentials (NTLM/Kerberos) against the corporate HTTP proxy.
#
# Terminal 1 (leave running):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\git-connect-proxy.ps1
#
# Terminal 2:
#   . .\scripts\corp-proxy-env.ps1
#   git -c http.proxy=$env:HTTP_PROXY push github main
#   npx playwright install chromium

param(
  [string]$ListenHost = "127.0.0.1",
  [int]$ListenPort = 18081,
  [string]$CorpProxy = ""
)
if (-not $CorpProxy) {
  $local = Join-Path $PSScriptRoot "corp-proxy.local.ps1"
  if (Test-Path $local) { . $local }
  $CorpProxy = $env:TV_CORP_HTTP_PROXY
}
if (-not $CorpProxy) {
  throw "Set TV_CORP_HTTP_PROXY or create scripts/corp-proxy.local.ps1 (gitignored; never commit the corporate proxy hostname)."
}

$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;

public static class GitConnectProxy {
  static readonly List<object> KeepAlive = new List<object>();

  public static void Run(string listenHost, int listenPort, string corpProxy) {
    ServicePointManager.Expect100Continue = false;
    var listener = new TcpListener(IPAddress.Parse(listenHost), listenPort);
    listener.Start();
    Console.WriteLine("ready " + listenHost + ":" + listenPort);
    Console.Out.Flush();
    while (true) {
      var client = listener.AcceptTcpClient();
      ThreadPool.QueueUserWorkItem(_ => Handle(client, corpProxy));
    }
  }

  static void Handle(TcpClient client, string corpProxy) {
    NetworkStream clientStream = null;
    try {
      client.NoDelay = true;
      clientStream = client.GetStream();
      var headers = ReadHttpHead(clientStream);
      var first = headers.Split(new[] { "\r\n" }, StringSplitOptions.None)[0];
      var parts = first.Split(' ');
      if (parts.Length < 2 || !parts[0].Equals("CONNECT", StringComparison.OrdinalIgnoreCase)) {
        var msg = Encoding.ASCII.GetBytes("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n");
        clientStream.Write(msg, 0, msg.Length);
        return;
      }
      var dest = parts[1];
      if (dest.IndexOf(':') < 0) dest += ":443";
      Console.WriteLine("CONNECT " + dest);
      Console.Out.Flush();

      var proxy = new WebProxy(corpProxy);
      proxy.Credentials = CredentialCache.DefaultNetworkCredentials;
      var req = (HttpWebRequest)WebRequest.Create("http://" + dest + "/");
      req.Method = "CONNECT";
      req.Proxy = proxy;
      req.KeepAlive = true;
      req.Timeout = 120000;
      var resp = (HttpWebResponse)req.GetResponse();
      lock (KeepAlive) { KeepAlive.Add(req); KeepAlive.Add(resp); }
      var rstream = resp.GetResponseStream();
      var sockProp = rstream.GetType().GetProperty("InternalSocket", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
      var sock = (Socket)sockProp.GetValue(rstream, null);
      var owned = new Socket(sock.DuplicateAndClose(System.Diagnostics.Process.GetCurrentProcess().Id));
      owned.NoDelay = true;
      var ns = new NetworkStream(owned, true);

      var ok = Encoding.ASCII.GetBytes("HTTP/1.1 200 Connection Established\r\n\r\n");
      clientStream.Write(ok, 0, ok.Length);
      clientStream.Flush();

      var t1 = new Thread(() => Pump(clientStream, ns));
      var t2 = new Thread(() => Pump(ns, clientStream));
      t1.IsBackground = true;
      t2.IsBackground = true;
      t1.Start();
      t2.Start();
      t1.Join();
      t2.Join();
    } catch (Exception ex) {
      Console.Error.WriteLine(ex.ToString());
    } finally {
      try { if (clientStream != null) clientStream.Close(); } catch {}
      try { client.Close(); } catch {}
    }
  }

  static string ReadHttpHead(NetworkStream s) {
    var ms = new MemoryStream();
    var b = new byte[1];
    while (true) {
      int n = s.Read(b, 0, 1);
      if (n <= 0) throw new IOException("client closed during headers");
      ms.Write(b, 0, 1);
      var arr = ms.ToArray();
      if (arr.Length >= 4 && arr[arr.Length - 4] == 13 && arr[arr.Length - 3] == 10 && arr[arr.Length - 2] == 13 && arr[arr.Length - 1] == 10)
        return Encoding.ASCII.GetString(arr);
      if (arr.Length > 16384) throw new IOException("headers too large");
    }
  }

  static void Pump(Stream a, Stream b) {
    try {
      var buf = new byte[8192];
      int n;
      while ((n = a.Read(buf, 0, buf.Length)) > 0) {
        b.Write(buf, 0, n);
        b.Flush();
      }
    } catch {}
  }
}
'@

[GitConnectProxy]::Run($ListenHost, $ListenPort, $CorpProxy)
