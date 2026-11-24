using SyndicateLauncher.Services;

if (!MatchOptions.IsPlaylist("worldcupsolo"))
    throw new Exception("World Cup Solo is missing from the launcher playlist allowlist.");

if (MatchOptions.NormalizePlaylist("WORLD CUP SOLO") != "solo")
    throw new Exception("Unknown playlist values should retain the safe Solo fallback.");

if (MatchOptions.NormalizePlaylist("worldcupsolo") != "worldcupsolo")
    throw new Exception("World Cup Solo normalization failed.");

if (MatchOptions.PlaylistName("worldcupsolo") != "World Cup Solo")
    throw new Exception("World Cup Solo display name is incorrect.");

Console.WriteLine("Launcher World Cup Solo playlist-option tests passed.");
