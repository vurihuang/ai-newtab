import { expect, test } from "bun:test";
import { isBlocked, normalizeBlockList } from "@homepage/agent-core";

test("normalizes pasted hosts and URLs", () => {
  expect(normalizeBlockList([" HTTPS://WWW.Google.COM/path ", "", " # comment", "*.Example.COM", "google.com"])).toEqual(["google.com", "*.example.com"]);
});

test("matches hosts and subdomains without matching lookalikes", () => {
  for (const host of ["google.com", "mail.google.com", "https://WWW.GOOGLE.COM./path"]) {
    expect(isBlocked(host, ["google.com"])).toBe(true);
  }
  expect(isBlocked("deep.sub.example.com", ["*.example.com"])).toBe(true);
  expect(isBlocked("example.com", ["*.example.com"])).toBe(true);
  for (const url of ["https:/mail.google.com", "https:\\mail.google.com", "HTTPS://user:pw@Mail.Google.com:443/x"]) {
    expect(isBlocked(url, ["google.com"])).toBe(true);
  }
  expect(isBlocked("localhost:3000", ["localhost"])).toBe(true);
  expect(isBlocked("notgoogle.com", ["google.com"])).toBe(false);
  expect(isBlocked("google.com.evil.test", ["google.com"])).toBe(false);
});

test("always blocks loopback, private and local-network hosts", () => {
  for (const host of ["localhost", "127.0.0.1", "127.0.0.1:8080", "[::1]", "10.1.2.3", "192.168.1.5", "172.16.0.9", "169.254.1.1", "printer.local", "build.internal"]) {
    expect(isBlocked(host, [])).toBe(true);
  }
  expect(isBlocked("example.com", [])).toBe(false);
});
