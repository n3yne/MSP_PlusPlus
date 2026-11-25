"use strict";

const { MICROSOFT_LOGIN_HOSTS, chromeUserAgent, userAgentHosts } = require("../src/main/user-agent");

describe("chromeUserAgent", () => {
  test("looks like Chrome with no Electron or app token", () => {
    const ua = chromeUserAgent("142.0.7444.59", "win32");
    expect(ua).toBe("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36");
    expect(ua).not.toMatch(/Electron|msp/i);
  });

  test("names the right platform", () => {
    expect(chromeUserAgent("1", "darwin")).toContain("Macintosh");
    expect(chromeUserAgent("1", "linux")).toContain("Linux x86_64");
  });
});

describe("userAgentHosts", () => {
  test("Microsoft sign-in hosts are always included, even with no sites", () => {
    const { hosts, exactHosts } = userAgentHosts([]);
    expect(hosts).toEqual([]);
    expect(exactHosts).toEqual(expect.arrayContaining(["login.microsoftonline.com", "login.microsoft.com", "login.live.com"]));
    expect(userAgentHosts(undefined).exactHosts).toEqual(MICROSOFT_LOGIN_HOSTS);
  });

  test("adds hosts of sites that ask for the Chrome user agent only", () => {
    const { hosts, exactHosts } = userAgentHosts([
      { chromeUserAgent: true, hosts: ["freshservice.com"], extraHosts: ["service.example.com"] },
      { chromeUserAgent: false, hosts: ["other.com"], extraHosts: ["x.other.com"] },
      { chromeUserAgent: true, hosts: ["freshservice.com", "myconnectwise.net"], extraHosts: [] },
    ]);
    expect(hosts).toEqual(["freshservice.com", "myconnectwise.net"]);
    expect(exactHosts).toContain("service.example.com");
    expect(exactHosts).not.toContain("x.other.com");
    expect(exactHosts.filter((h) => h === "login.microsoftonline.com")).toHaveLength(1);
  });
});
