const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const playlists = require(path.resolve(
  __dirname,
  "..",
  "ESnowLauncherBETAOFFICIAL snow filesLauncherSnowLauncherRuntimeMatchmaker",
  "playlists.cjs"
));

function withBuild(build, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snow-worldcup-"));
  fs.writeFileSync(path.join(dir, "active-build.json"), JSON.stringify({ Build: build }));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("World Cup Solo asset name resolves to its own matchmaking mode", () => {
  assert.equal(
    playlists.modeFromName("Playlist_Showdown_WorldCup_Solo"),
    "worldcupsolo"
  );
  assert.equal(
    playlists.playlistMode("a:b:c:playlist_showdown_worldcup_solo"),
    "worldcupsolo"
  );
});

test("World Cup Solo reservations are accepted on 9.40", () => {
  withBuild("9.40", (dir) => {
    const ticket = playlists.reserve("worldcupsolo", "test-account", dir, Date.now(), "9.40");
    assert.equal(ticket.mode, "worldcupsolo");
    assert.equal(ticket.build, "9.40");
    assert.match(ticket.id, /^[a-f0-9]{32}$/);

    const remote = playlists.reserveRemote(
      "worldcupsolo",
      "remote-account",
      "127.0.0.1",
      "b".repeat(32),
      dir,
      "9.40"
    );
    assert.equal(remote.mode, "worldcupsolo");
    assert.equal(remote.build, "9.40");
  });
});

test("World Cup Solo reservations are rejected on other builds", () => {
  withBuild("10.40", (dir) => {
    assert.throws(
      () => playlists.reserve("worldcupsolo", "test-account", dir, Date.now(), "10.40"),
      /only in Season 9/
    );
    assert.throws(
      () => playlists.reserveRemote("worldcupsolo", "test-account", "127.0.0.1", "a".repeat(32), dir, "10.40"),
      /only in Season 9/
    );
    assert.equal(playlists.prewarm("worldcupsolo", dir), false);
  });
});

test("World Cup Solo prewarm is enabled only on 9.40", () => {
  withBuild("9.40", (dir) => {
    assert.equal(playlists.prewarm("worldcupsolo", dir), true);
    const request = playlists.read(path.join(dir, "playlist-request.json"));
    assert.equal(request.Mode, "worldcupsolo");
    assert.equal(request.Build, "9.40");
    assert.equal(request.Prewarm, true);
  });
});
