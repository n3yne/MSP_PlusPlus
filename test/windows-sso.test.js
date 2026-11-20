"use strict";

const { createWindowsSso, isLoginUrl, headersFromCookies } = require("../src/main/windows-sso");

const PROOF = "eyJhbGciOiJSUzI1NiJ9.eyJyZWZyZXNoX3Rva2VuIjoieCJ9.c2ln";

function fakeSession() {
  const ses = { listener: undefined, filter: undefined };
  ses.webRequest = {
    onBeforeSendHeaders(filter, fn) {
      if (filter === null) { ses.filter = undefined; ses.listener = null; return; }
      ses.filter = filter;
      ses.listener = fn;
    },
  };
  return ses;
}

function setup(opts) {
  const o = opts || {};
  const calls = [];
  const sessions = {};
  let t = 0;
  const native = {
    getCookies: jest.fn(async (uri) => {
      calls.push(uri);
      if (o.throws) throw new Error("COM said no");
      return o.cookies || [
        { name: "x-ms-RefreshTokenCredential", data: PROOF + "; path=/; domain=login.microsoftonline.com; secure; httponly", flags: 8256 },
        { name: "x-ms-DeviceCredential", data: "dev.cred.sig; path=/; secure", flags: 8256 },
      ];
    }),
  };
  const sso = createWindowsSso({
    platform: o.platform || "win32",
    loader: () => (o.unavailable ? { available: false, loadError: new Error("no addon") } : { available: true, native }),
    fromPartition: (name) => (sessions[name] = sessions[name] || fakeSession()),
    now: () => t,
  });
  return { sso, native, calls, sessions, tick: (ms) => { t += ms; } };
}

function send(ses, details) {
  return new Promise((resolve) => ses.listener(details, resolve));
}

describe("windows-sso isLoginUrl", () => {
  test("only the exact Microsoft login hosts over https", () => {
    expect(isLoginUrl("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1")).toBe(true);
    expect(isLoginUrl("https://LOGIN.microsoft.com/")).toBe(true);
    expect(isLoginUrl("http://login.microsoftonline.com/")).toBe(false);
    expect(isLoginUrl("https://login.microsoftonline.com.evil.example/")).toBe(false);
    expect(isLoginUrl("https://evil.example/login.microsoftonline.com/")).toBe(false);
    expect(isLoginUrl("https://evil.example/?u=https://login.microsoftonline.com/")).toBe(false);
    expect(isLoginUrl("https://login.microsoftonline.com:8443/")).toBe(false);
    expect(isLoginUrl("https://user@login.microsoftonline.com/")).toBe(false);
    expect(isLoginUrl("https://m365.cloud.microsoft/chat")).toBe(false);
    expect(isLoginUrl("not a url")).toBe(false);
  });
});

describe("windows-sso headersFromCookies", () => {
  test("keeps the value before the cookie attributes", () => {
    expect(headersFromCookies([
      { name: "x-ms-RefreshTokenCredential", data: PROOF + "; path=/; secure" },
      { name: "x-ms-RefreshTokenCredential1", data: "second.account.proof" },
    ])).toEqual({ "x-ms-RefreshTokenCredential": PROOF, "x-ms-RefreshTokenCredential1": "second.account.proof" });
  });

  test("drops other names and values that could break the header", () => {
    expect(headersFromCookies([
      { name: "Cookie", data: "a=b" },
      { name: "x-ms-Other", data: "x" },
      { name: "x-ms-RefreshTokenCredential", data: "bad\r\nInjected: yes" },
      { name: "x-ms-DeviceCredential", data: "" },
      null,
      { name: 3, data: "x" },
    ])).toEqual({});
    expect(headersFromCookies(undefined)).toEqual({});
  });
});

describe("windows-sso availability", () => {
  test("available when Windows returns a refresh credential, cached for a minute", async () => {
    const { sso, native, tick } = setup();
    expect(await sso.isAvailable()).toBe(true);
    expect(await sso.isAvailable()).toBe(true);
    expect(native.getCookies).toHaveBeenCalledTimes(1);
    expect(native.getCookies).toHaveBeenCalledWith("https://login.microsoftonline.com/");
    tick(61000);
    await sso.isAvailable();
    expect(native.getCookies).toHaveBeenCalledTimes(2);
  });

  test("not available on an unregistered PC, off Windows, without the addon, or when Windows fails", async () => {
    expect(await setup({ cookies: [] }).sso.isAvailable()).toBe(false);
    expect(await setup({ cookies: [{ name: "x-ms-DeviceCredential", data: "d" }] }).sso.isAvailable()).toBe(false);
    expect(await setup({ platform: "darwin" }).sso.isAvailable()).toBe(false);
    expect(await setup({ unavailable: true }).sso.isAvailable()).toBe(false);
    expect(await setup({ throws: true }).sso.isAvailable()).toBe(false);
  });

  test("headersFor never asks Windows about other sites", async () => {
    const { sso, native } = setup();
    expect(await sso.headersFor("https://evil.example/")).toEqual({});
    expect(native.getCookies).not.toHaveBeenCalled();
  });
});

describe("windows-sso sessions", () => {
  test("adds the proofs to sign-in page loads, asking Windows with the request's own URL", async () => {
    const { sso, sessions, calls } = setup();
    const api = sso.forPlugin("ai-features");
    expect(api.setForPartition("persist:msp-copilot-web", true)).toBe(true);
    const ses = sessions["persist:msp-copilot-web"];
    expect(ses.filter).toEqual({ urls: ["https://login.microsoftonline.com/*", "https://login.microsoft.com/*"] });

    const url = "https://login.microsoftonline.com/common/oauth2/authorize?sso_nonce=abc";
    const res = await send(ses, { url, resourceType: "mainFrame", requestHeaders: { "User-Agent": "x", "X-Ms-RefreshTokenCredential": "page-supplied" } });
    expect(res.requestHeaders).toEqual({
      "User-Agent": "x",
      "x-ms-RefreshTokenCredential": PROOF,
      "x-ms-DeviceCredential": "dev.cred.sig",
    });
    expect(calls).toEqual([url]);
  });

  test("leaves scripts, images and other hosts alone", async () => {
    const { sso, sessions, native } = setup();
    sso.forPlugin("ai-features").setForPartition("persist:msp-copilot-web", true);
    const ses = sessions["persist:msp-copilot-web"];
    expect(await send(ses, { url: "https://login.microsoftonline.com/x.js", resourceType: "script", requestHeaders: {} })).toEqual({});
    expect(await send(ses, { url: "https://evil.example/", resourceType: "mainFrame", requestHeaders: {} })).toEqual({});
    expect(native.getCookies).not.toHaveBeenCalled();
  });

  test("passes requests through unchanged when there's no proof", async () => {
    const { sso, sessions } = setup({ cookies: [] });
    sso.forPlugin("ai-features").setForPartition("persist:msp-copilot-web", true);
    const res = await send(sessions["persist:msp-copilot-web"], { url: "https://login.microsoftonline.com/", resourceType: "subFrame", requestHeaders: { A: "1" } });
    expect(res).toEqual({});
  });

  test("turning it off removes the listener", () => {
    const { sso, sessions } = setup();
    const api = sso.forPlugin("ai-features");
    api.setForPartition("persist:msp-copilot-web", true);
    expect(api.setForPartition("persist:msp-copilot-web", false)).toBe(false);
    expect(sessions["persist:msp-copilot-web"].listener).toBeNull();
  });

  test("only persist: sessions, never the app's own, and not another plugin's", () => {
    const { sso } = setup();
    const a = sso.forPlugin("ai-features");
    const b = sso.forPlugin("other");
    expect(() => a.setForPartition("", true)).toThrow(/persist:/);
    expect(() => a.setForPartition("msp-copilot-web", true)).toThrow(/persist:/);
    expect(() => a.setForPartition("persist:../x", true)).toThrow(/persist:/);
    a.setForPartition("persist:msp-copilot-web", true);
    expect(() => b.setForPartition("persist:msp-copilot-web", true)).toThrow(/another plugin/);
    expect(() => b.setForPartition("persist:msp-copilot-web", false)).toThrow(/another plugin/);
  });

  test("a plugin sees no way to read the proofs", () => {
    const api = setup().sso.forPlugin("ai-features");
    expect(Object.keys(api).sort()).toEqual(["isAvailable", "setForPartition"]);
    expect(Object.isFrozen(api)).toBe(true);
  });
});
