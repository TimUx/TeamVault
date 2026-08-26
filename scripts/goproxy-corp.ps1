# Local Go module proxy that fetches via corporate HTTP proxy using
# Windows DefaultNetworkCredentials (NTLM/Kerberos).
#
# Terminal 1:
#   powershell -File .\scripts\goproxy-corp.ps1
# Terminal 2:
#   $env:GOPROXY = 'http://127.0.0.1:18080'
#   $env:GOSUMDB = 'off'   # optional if sum.golang.org also blocked
#   go mod tidy
#   go test ./...

param(
    [string]$ListenPrefix = "http://127.0.0.1:18080/",
    [string]$CorpProxy = "http://proxy.example.internal:8080",
    [string]$Upstream = "https://proxy.golang.org"
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

public static class CorpGoProxy {
  public static void Run(string prefix, string corpProxy, string upstream) {
    var listener = new HttpListener();
    listener.Prefixes.Add(prefix);
    listener.Start();
    Console.WriteLine("goproxy-corp on " + prefix);
    Console.WriteLine("  corp proxy: " + corpProxy);
    Console.WriteLine("  upstream:   " + upstream);
    while (true) {
      var ctx = listener.GetContext();
      ThreadPool.QueueUserWorkItem(_ => Serve(ctx, corpProxy, upstream));
    }
  }

  static void Serve(HttpListenerContext ctx, string corpProxy, string upstream) {
    try {
      var path = ctx.Request.Url.AbsolutePath; // e.g. /modernc.org/sqlite/@v/v1.34.5.info
      if (path == "/" || path == "/favicon.ico") {
        Write(ctx, 200, "text/plain", Encoding.UTF8.GetBytes("teamvault corp goproxy ok\n"));
        return;
      }
      var url = upstream.TrimEnd('/') + path + ctx.Request.Url.Query;
      Console.WriteLine(ctx.Request.HttpMethod + " " + path);

      var req = (HttpWebRequest)WebRequest.Create(url);
      req.Method = "GET";
      req.Proxy = new WebProxy(corpProxy);
      req.Proxy.Credentials = CredentialCache.DefaultNetworkCredentials;
      req.Timeout = 180000;
      req.UserAgent = "teamvault-goproxy-corp";

      using (var resp = (HttpWebResponse)req.GetResponse())
      using (var stream = resp.GetResponseStream())
      using (var ms = new MemoryStream()) {
        stream.CopyTo(ms);
        var ctype = resp.ContentType;
        if (string.IsNullOrEmpty(ctype)) ctype = "application/octet-stream";
        Write(ctx, (int)resp.StatusCode, ctype, ms.ToArray());
      }
    } catch (WebException ex) {
      var code = 502;
      var body = ex.Message;
      if (ex.Response != null) {
        code = (int)((HttpWebResponse)ex.Response).StatusCode;
        using (var s = ex.Response.GetResponseStream())
        using (var sr = new StreamReader(s)) body = sr.ReadToEnd();
      }
      Console.Error.WriteLine("upstream error " + code + ": " + body);
      Write(ctx, code, "text/plain", Encoding.UTF8.GetBytes(body));
    } catch (Exception ex) {
      Console.Error.WriteLine(ex.ToString());
      Write(ctx, 500, "text/plain", Encoding.UTF8.GetBytes(ex.Message));
    }
  }

  static void Write(HttpListenerContext ctx, int code, string ctype, byte[] body) {
    ctx.Response.StatusCode = code;
    ctx.Response.ContentType = ctype;
    ctx.Response.ContentLength64 = body.LongLength;
    ctx.Response.OutputStream.Write(body, 0, body.Length);
    ctx.Response.OutputStream.Close();
  }
}
"@

# Allow URL ACL for non-admin if needed; 127.0.0.1 usually works.
[CorpGoProxy]::Run($ListenPrefix, $CorpProxy, $Upstream)
