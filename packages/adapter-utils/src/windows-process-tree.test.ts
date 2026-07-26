import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: unknown[]) => spawnMock(...args) };
});

const { signalRunningProcess } = await import("./server-utils.js");

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

function fakeKiller() {
  return { on: vi.fn(), unref: vi.fn() };
}

function fakeChild(
  overrides: { pid?: number | undefined; exitCode?: number | null; signalCode?: string | null } = {},
) {
  return {
    pid: "pid" in overrides ? overrides.pid : 4242,
    exitCode: overrides.exitCode ?? null,
    signalCode: overrides.signalCode ?? null,
    kill: vi.fn(),
  } as unknown as Parameters<typeof signalRunningProcess>[0]["child"] & { kill: ReturnType<typeof vi.fn> };
}

function taskkillArgs() {
  const call = spawnMock.mock.calls.find(([command]) => command === "taskkill");
  return call?.[1] as string[] | undefined;
}

describe("signalRunningProcess on Windows", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockReturnValue(fakeKiller());
    setPlatform("win32");
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("kills the whole process tree instead of only the direct child", () => {
    // Windows has no process groups, so killing the direct child leaves a
    // `.cmd` wrapper's real agent process running — and the run hanging,
    // because "close" waits on the inherited stdout pipe.
    const child = fakeChild();
    signalRunningProcess({ child, processGroupId: null }, "SIGTERM");

    expect(taskkillArgs()).toEqual(["/PID", "4242", "/T"]);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("forces the kill for SIGKILL", () => {
    const child = fakeChild();
    signalRunningProcess({ child, processGroupId: null }, "SIGKILL");

    expect(taskkillArgs()).toEqual(["/PID", "4242", "/T", "/F"]);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("swallows taskkill errors rather than emitting an unhandled event", () => {
    const killer = fakeKiller();
    spawnMock.mockReturnValue(killer);
    signalRunningProcess({ child: fakeChild(), processGroupId: null }, "SIGTERM");

    const handler = killer.on.mock.calls.find(([event]) => event === "error");
    expect(handler).toBeDefined();
    expect(() => handler?.[1](new Error("taskkill not found"))).not.toThrow();
  });

  it("falls back to the direct child when taskkill cannot be spawned", () => {
    spawnMock.mockImplementation(() => {
      throw new Error("spawn ENOENT");
    });
    const child = fakeChild();
    signalRunningProcess({ child, processGroupId: null }, "SIGTERM");

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("falls back to the direct child when there is no pid", () => {
    const child = fakeChild({ pid: undefined });
    signalRunningProcess({ child, processGroupId: null }, "SIGKILL");

    expect(taskkillArgs()).toBeUndefined();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it.each([
    ["exited", { exitCode: 0 }],
    ["signalled", { signalCode: "SIGTERM" }],
  ])("does nothing once the child has already %s", (_label, state) => {
    const child = fakeChild(state);
    signalRunningProcess({ child, processGroupId: null }, "SIGKILL");

    expect(taskkillArgs()).toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("ignores processGroupId, which is always null on Windows", () => {
    const child = fakeChild();
    signalRunningProcess({ child, processGroupId: 4242 }, "SIGTERM");

    expect(taskkillArgs()).toEqual(["/PID", "4242", "/T"]);
  });
});

describe("signalRunningProcess on POSIX", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockReturnValue(fakeKiller());
    setPlatform("linux");
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("never reaches for taskkill", () => {
    const child = fakeChild();
    signalRunningProcess({ child, processGroupId: null }, "SIGTERM");

    expect(taskkillArgs()).toBeUndefined();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("still escalates SIGKILL after SIGTERM was already sent", () => {
    const child = fakeChild();
    signalRunningProcess({ child, processGroupId: null }, "SIGTERM");
    signalRunningProcess({ child, processGroupId: null }, "SIGKILL");

    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });
});
