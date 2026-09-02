// Mature autofill — no vault keys (Zero-Knowledge). Keys stay in popup.
const api = typeof browser !== "undefined" ? browser : chrome;

function setNativeValue(el, value) {
  if (!el) return;
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  el.focus();
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: value }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

function visible(el) {
  if (!el || el.disabled || el.readOnly) return false;
  const s = getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function scoreUsername(el) {
  const a = ((el.getAttribute("autocomplete") || "") + " " + (el.name || "") + " " + (el.id || "") + " " + (el.placeholder || "")).toLowerCase();
  let s = 0;
  if (/username|user-name|login|email|e-mail|account/.test(a)) s += 5;
  if (el.type === "email") s += 4;
  if (el.type === "text" || el.type === "tel") s += 1;
  if (el.type === "password" || el.type === "hidden" || el.type === "search") s -= 10;
  return s;
}

function findLoginFields(root = document) {
  const inputs = [...root.querySelectorAll("input")].filter(visible);
  const passwords = inputs.filter((el) => el.type === "password");
  const password = passwords[0] || null;
  let username = null;
  let best = -1;
  for (const el of inputs) {
    const sc = scoreUsername(el);
    if (sc > best) {
      best = sc;
      username = el;
    }
  }
  if (username && password && username === password) username = null;
  // Prefer field before password in DOM
  if (password && !username) {
    const idx = inputs.indexOf(password);
    for (let i = idx - 1; i >= 0; i--) {
      if (scoreUsername(inputs[i]) > 0) {
        username = inputs[i];
        break;
      }
    }
  }
  const totp = inputs.find((el) => {
    const a = ((el.autocomplete || "") + (el.name || "") + (el.id || "")).toLowerCase();
    return /otp|totp|one-?time|mfa|2fa|authenticator/.test(a);
  }) || null;
  return { username, password, totp, formCount: passwords.length };
}

function fillLogin(msg) {
  if (msg.expectedOrigin && location.origin !== msg.expectedOrigin) {
    return {
      filledUser: false,
      filledPass: false,
      filledTotp: false,
      host: location.hostname,
      origin: location.origin,
      blocked: true,
    };
  }
  const { username, password, totp } = findLoginFields();
  if (msg.username != null && username) setNativeValue(username, msg.username);
  if (msg.password != null && password) setNativeValue(password, msg.password);
  if (msg.totp != null && totp) setNativeValue(totp, msg.totp);
  return {
    filledUser: !!(msg.username != null && username),
    filledPass: !!(msg.password != null && password),
    filledTotp: !!(msg.totp != null && totp),
    host: location.hostname,
  };
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "tv-fill") {
    sendResponse(fillLogin(msg));
    return true;
  }
  if (msg?.type === "tv-detect") {
    const f = findLoginFields();
    sendResponse({
      hasPassword: !!f.password,
      hasUsername: !!f.username,
      hasTotp: !!f.totp,
      host: location.hostname,
      href: location.href,
    });
    return true;
  }
  return false;
});
