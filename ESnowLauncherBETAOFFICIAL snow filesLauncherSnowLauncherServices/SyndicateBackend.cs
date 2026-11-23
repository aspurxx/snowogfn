
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace SyndicateLauncher.Services;

/// <summary>
/// Runs the Project Snow Node backend.
/// It serves the Fortnite API on 127.0.0.1:3551 and keeps accounts in local MongoDB.
/// </summary>
public static class SyndicateBackend
{
    private const int ApiPort = 3551;
    private const int MongoPort = 27028;

    private static readonly HttpClient Http = new()
    {
        BaseAddress = new Uri($"http://127.0.0.1:{ApiPort}/"),
        Timeout = TimeSpan.FromSeconds(30)
    };

    private static readonly List<Process> Started = new();
    private static readonly SemaphoreSlim StartGate = new(1, 1);
    private static int _startedSeason = -1;

    /// <summary>
    /// The shared Runtime\Server folder the matchmaker reads server/build state from.
    /// </summary>
    public static string? RuntimeDirectory
    {
        get
        {
            var backend = FindBackend();
            return backend is null
                ? null
                : Path.GetFullPath(Path.Combine(backend, "Server"));
        }
    }

    /// <summary>
    /// Finds the backend inside the extracted Runtime first, then checks older installations.
    /// </summary>
    public static string? FindBackend()
    {
        foreach (var candidate in BackendCandidates())
        {
            if (File.Exists(Path.Combine(candidate, "src", "index.js")) &&
                File.Exists(Path.Combine(candidate, "package.json")) &&
                Directory.Exists(Path.Combine(candidate, "node_modules")))
            {
                return candidate;
            }
        }

        return null;
    }

    private static IEnumerable<string> BackendCandidates()
    {
        string local = Environment.GetFolderPath(
            Environment.SpecialFolder.LocalApplicationData);

        string documents = Environment.GetFolderPath(
            Environment.SpecialFolder.MyDocuments);

        // The bundled Runtime is extracted by RuntimeBundle.
        // Its root contains src, package.json, node_modules, Matchmaker and Server.
        yield return RuntimeBundle.Resolve();

        // Older standalone backend locations.
        yield return Path.Combine(
            AppContext.BaseDirectory,
            "Syndicate-backend");

        yield return Path.Combine(
            local,
            "SyndicateLauncher",
            "Syndicate-backend");

        // Older Project Tilted installations.
        string legacyBackend = "Til" + "ted-backend";

        yield return Path.Combine(
            documents,
            "Project Tilted",
            legacyBackend);

        yield return Path.Combine(
            documents,
            "tiltedlegacy",
            legacyBackend);
    }

    private static string? FindNode(string backend)
    {
        string documents = Environment.GetFolderPath(
            Environment.SpecialFolder.MyDocuments);

        foreach (var candidate in new[]
        {
            Path.Combine(backend, "Dependencies", "Node", "node.exe"),

            Path.Combine(
                Path.GetDirectoryName(backend) ?? "",
                "Dependencies", "Node", "node.exe"),

            Path.Combine(
                Path.GetDirectoryName(Path.GetDirectoryName(backend) ?? "") ?? "",
                "Dependencies", "Node", "node.exe"),

            Path.Combine(
                documents,
                "Project Tilted",
                "Dependencies", "Node", "node.exe"),

            Path.Combine(
                documents,
                "tiltedlegacy",
                "Dependencies", "Node", "node.exe")
        })
        {
            if (File.Exists(candidate))
                return candidate;
        }

        // Node.js is installed separately and must be available on PATH.
        return "node.exe";
    }

    internal static string? FindMongo(string backend)
    {
        string documents = Environment.GetFolderPath(
            Environment.SpecialFolder.MyDocuments);

        foreach (var candidate in new[]
        {
            // Bundled MongoDB inside the extracted Runtime.
            Path.Combine(
                backend,
                "Dependencies", "MongoDB", "mongod.exe"),

            // Older standalone installation locations.
            Path.Combine(
                Path.GetDirectoryName(backend) ?? "",
                "Dependencies", "MongoDB", "mongod.exe"),

            Path.Combine(
                Path.GetDirectoryName(Path.GetDirectoryName(backend) ?? "") ?? "",
                "Dependencies", "MongoDB", "mongod.exe"),

            Path.Combine(
                documents,
                "Project Tilted",
                "Dependencies", "MongoDB", "mongod.exe"),

            Path.Combine(
                documents,
                "tiltedlegacy",
                "Dependencies", "MongoDB", "mongod.exe")
        })
        {
            if (File.Exists(candidate))
                return candidate;
        }

        return null;
    }

    /// <summary>
    /// Starts MongoDB, the Node API and the matchmaker before Play is pressed.
    /// Failures are ignored here; Play retries and reports them.
    /// </summary>
    public static async Task WarmUpAsync(int mainSeason)
    {
        try
        {
            await EnsureRunningAsync(_ => { }, mainSeason);
        }
        catch
        {
            // Play retries and reports the real error.
        }
    }

    public static async Task EnsureRunningAsync(
        Action<string> status,
        int mainSeason = 7)
    {
        await StartGate.WaitAsync();

        try
        {
            await EnsureRunningCoreAsync(status, mainSeason);

            // Import players from an older Project Tilted installation once per launcher run.
            if (FindBackend() is { } backend)
            {
                await TiltedImport.RunOnceAsync(
                    FindMongo(backend),
                    Http,
                    status);
            }
        }
        finally
        {
            StartGate.Release();
        }
    }

    private static async Task EnsureRunningCoreAsync(
        Action<string> status,
        int mainSeason)
    {
        var backend = FindBackend()
            ?? throw new InvalidOperationException(
#if DEV_BUILD
                "The Project Snow backend is missing from the bundled Runtime. Check that the Runtime folder was included in the launcher build.");
#else
                "The Project Snow backend is missing. Reinstall the launcher using the complete ZIP and add the Project Snow folder to your antivirus exclusions.");
#endif

        bool ours = Started.Any(process => !process.HasExited);

        if (await IsUpAsync())
        {
            if (ours && _startedSeason == mainSeason)
            {
                await EnsureMatchmakerAsync(backend, status);
                return;
            }

            if (ours)
            {
                // One backend serves one season's Battle Pass data.
                status("Restarting the local backend for the selected season...");
                StopStarted();
                await Task.Delay(600);
            }
            else
            {
                // Replace a backend left by another installation.
                status("Stopping the previous local backend...");
                StopListener(ApiPort, status);

                if (PortOpen(6969))
                    StopListener(6969, status);

                await Task.Delay(600);
            }
        }

        if (PortOpen(6969))
            StopListener(6969, status);

        // Start MongoDB only if it is not already listening.
        if (!PortOpen(MongoPort))
        {
            var mongod = FindMongo(backend)
                ?? throw new InvalidOperationException(
                    "MongoDB is not running and the bundled mongod.exe could not be found.");

            status("Starting the local account database...");

            StartMongo(mongod);

            await WaitForPortAsync(
                MongoPort,
                TimeSpan.FromSeconds(30),
                "MongoDB");
        }

        status("Starting the Project Snow backend...");

        StartNode(backend, mainSeason);

        await WaitForApiAsync(TimeSpan.FromSeconds(45));

        await EnsureMatchmakerAsync(backend, status);
    }

    private static async Task EnsureMatchmakerAsync(
        string backend,
        Action<string> status)
    {
        if (PortOpen(6969))
            return;

        var matchmaker = Path.Combine(
            backend,
            "Matchmaker",
            "index.js");

        if (!File.Exists(matchmaker))
            return;

        status("Starting matchmaking...");

        // Save matchmaker output for troubleshooting.
        string? mmLog = null;

        try
        {
            var logDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "SyndicateLauncher",
                "Logs");

            Directory.CreateDirectory(logDir);

            mmLog = Path.Combine(logDir, "matchmaker.log");
        }
        catch
        {
            mmLog = null;
        }

        var info = new ProcessStartInfo(FindNode(backend)!)
        {
            Arguments = "Matchmaker/index.js",
            WorkingDirectory = backend,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        var proc = Process.Start(info)
            ?? throw new InvalidOperationException("Could not start matchmaking.");

        TextWriter? mmWriter = null;

        try
        {
            if (mmLog != null)
            {
                mmWriter = TextWriter.Synchronized(
                    new StreamWriter(
                        new FileStream(
                            mmLog,
                            FileMode.Create,
                            FileAccess.Write,
                            FileShare.ReadWrite))
                    {
                        AutoFlush = true
                    });
            }
        }
        catch
        {
            mmWriter = null;
        }

        proc.OutputDataReceived += (_, e) =>
        {
            if (e.Data != null && mmWriter != null)
            {
                try { mmWriter.WriteLine(e.Data); }
                catch { }
            }
        };

        proc.ErrorDataReceived += (_, e) =>
        {
            if (e.Data != null && mmWriter != null)
            {
                try { mmWriter.WriteLine(e.Data); }
                catch { }
            }
        };

        try
        {
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
        }
        catch { }

        Started.Add(proc);

        await WaitForPortAsync(
            6969,
            TimeSpan.FromSeconds(15),
            "Matchmaking");
    }

    /// <summary>
    /// Signs a local player in and returns the exchange code Fortnite expects.
    /// </summary>
    public static async Task<string> ExchangeCodeAsync(
        string username,
        bool unlockAll,
        Action<string>? status = null,
        bool stwSkins = false)
    {
        var quick = await Http.PostAsJsonAsync(
            "launcher/quick",
            new { username });

        if (!quick.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                "The Project Snow backend could not create or find the player '" +
                username + "'.");
        }

        string token;

        using (var document = JsonDocument.Parse(
            await quick.Content.ReadAsStringAsync()))
        {
            token = document.RootElement.GetProperty("token").GetString()
                ?? throw new InvalidOperationException(
                    "The Project Snow backend returned no login token.");
        }

        using (var request = new HttpRequestMessage(
            HttpMethod.Post,
            "launcher/unlockall/set"))
        {
            request.Headers.Authorization =
                new AuthenticationHeaderValue("Bearer", token);

            request.Content = JsonContent.Create(
                new { enabled = unlockAll });

            using var response = await Http.SendAsync(request);
        }

        // Save the World skins.
        using (var request = new HttpRequestMessage(
            HttpMethod.Post,
            "launcher/stwskins/set"))
        {
            request.Headers.Authorization =
                new AuthenticationHeaderValue("Bearer", token);

            request.Content = JsonContent.Create(
                new { enabled = unlockAll && stwSkins });

            using var response = await Http.SendAsync(request);
        }

        using (var request = new HttpRequestMessage(
            HttpMethod.Post,
            "launcher/exchange"))
        {
            request.Headers.Authorization =
                new AuthenticationHeaderValue("Bearer", token);

            request.Content = JsonContent.Create(new { });

            using var response = await Http.SendAsync(request);

            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException(
                    "The Project Snow backend did not return a login code.");
            }

            using var document = JsonDocument.Parse(
                await response.Content.ReadAsStringAsync());

            status?.Invoke("Signed in as " + username + ".");

            return document.RootElement.GetProperty("code").GetString()
                ?? throw new InvalidOperationException(
                    "The Project Snow backend returned an empty login code.");
        }
    }

    // ----------------------------------------------------------------
    // Launcher Home: achievements, wallet and player management.
    // ----------------------------------------------------------------

    public static Task<bool> IsAvailableAsync() => IsUpAsync();

    private static async Task<string> PlayerTokenAsync(string username)
    {
        using var quick = await Http.PostAsJsonAsync(
            "launcher/quick",
            new { username });

        if (!quick.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                "The Project Snow backend could not find the player '" +
                username + "'.");
        }

        using var document = JsonDocument.Parse(
            await quick.Content.ReadAsStringAsync());

        return document.RootElement.GetProperty("token").GetString()
            ?? throw new InvalidOperationException(
                "The Project Snow backend returned no login token.");
    }

    /// <summary>
    /// POSTs to one of the backend's launcher routes as a player.
    /// </summary>
    public static async Task<string> PostAsPlayerAsync(
        string username,
        string route,
        object body)
    {
        string token = await PlayerTokenAsync(username);

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            route);

        request.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", token);

        request.Content = JsonContent.Create(body);

        using var response = await Http.SendAsync(request);

        string text = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            string message = "The backend refused the request.";

            try
            {
                using var doc = JsonDocument.Parse(text);

                if (doc.RootElement.TryGetProperty("message", out var m) &&
                    m.GetString() is { Length: > 0 } s)
                {
                    message = s;
                }
            }
            catch (JsonException) { }

            throw new InvalidOperationException(message);
        }

        return text;
    }

    /// <summary>
    /// Renames a player's backend account.
    /// </summary>
    public static async Task<bool> RenamePlayerAsync(
        string username,
        string newName)
    {
        using var response = await Http.PostAsJsonAsync(
            "launcher/players/rename",
            new { username, newName });

        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
            return false;

        await ThrowIfRefusedAsync(response);

        return true;
    }

    /// <summary>
    /// Deletes a player's backend account, profiles and friends list.
    /// </summary>
    public static async Task DeletePlayerAsync(string username)
    {
        using var response = await Http.PostAsJsonAsync(
            "launcher/players/delete",
            new { username });

        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
            return;

        await ThrowIfRefusedAsync(response);
    }

    private static async Task ThrowIfRefusedAsync(
        HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode)
            return;

        string message = "The Project Snow backend refused the change.";

        try
        {
            using var doc = JsonDocument.Parse(
                await response.Content.ReadAsStringAsync());

            if (doc.RootElement.TryGetProperty("message", out var m) &&
                m.GetString() is { Length: > 0 } text)
            {
                message = text;
            }
        }
        catch (JsonException) { }

        throw new InvalidOperationException(message);
    }

    /// <summary>
    /// Tells the backend whether this launch has the Syndicate menu on.
    /// </summary>
    public static Task SetMenuAsync(string username, bool active) =>
        PostAsPlayerAsync(
            username,
            "launcher/menu",
            new { active });

    /// <summary>
    /// Starts MongoDB using the player's separate local database directory.
    /// MongoDB program files remain in the bundled Runtime.
    /// </summary>
    private static void StartMongo(string mongod)
    {
        string root = LegacyData.DatabaseDirectory;

        Directory.CreateDirectory(root);

        var info = new ProcessStartInfo(mongod)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = Path.GetDirectoryName(mongod)!
        };

        foreach (var argument in new[]
        {
            "--dbpath", root,
            "--bind_ip", "127.0.0.1",
            "--port", MongoPort.ToString(),
            "--logpath", Path.Combine(root, "mongodb.log"),
            "--logappend"
        })
        {
            info.ArgumentList.Add(argument);
        }

        var process = Process.Start(info)
            ?? throw new InvalidOperationException("Could not start MongoDB.");

        Started.Add(process);
    }

    private static void StartNode(string backend, int mainSeason)
    {
        var info = new ProcessStartInfo(FindNode(backend)!)
        {
            Arguments = "src/index.js",
            WorkingDirectory = backend,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };

        string logDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SyndicateLauncher",
            "Logs");

        Directory.CreateDirectory(logDirectory);

        // These environment variables override values from the installation's .env.
        info.Environment["PORT"] = ApiPort.ToString();
        info.Environment["MONGO_URI"] =
            $"mongodb://127.0.0.1:{MongoPort}/project_tilted";

        info.Environment["MATCHMAKER_IP"] = "127.0.0.1:6969";
        info.Environment["GAMESERVER_IP"] = "127.0.0.1:7777";
        info.Environment["MAIN_SEASON"] = mainSeason.ToString();
        info.Environment["BACKEND_NAME"] = "Project Snow";

        info.Environment["TILTED_BACKEND_LOG"] = Path.Combine(
            logDirectory,
            "syndicate-backend.log");

        info.Environment["BOT_TOKEN"] = "";
        info.Environment["DISCORD_TOKEN"] = "";

#if DEV_BUILD
        info.Environment["TILTED_DEVKIT"] = "1";
#endif

        var process = Process.Start(info)
            ?? throw new InvalidOperationException(
                "Could not start the Project Snow backend.");

        Started.Add(process);

        _startedSeason = mainSeason;
    }

    private static async Task<bool> IsUpAsync()
    {
        if (!PortOpen(ApiPort))
            return false;

        try
        {
            using var response = await Http.GetAsync(
                "fortnite/api/version");

            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (TaskCanceledException)
        {
            return false;
        }
    }

    private static bool PortOpen(int port)
    {
        try
        {
            using var client = new TcpClient();

            return client.ConnectAsync("127.0.0.1", port).Wait(250)
                && client.Connected;
        }
        catch
        {
            return false;
        }
    }

    private static async Task WaitForPortAsync(
        int port,
        TimeSpan timeout,
        string name)
    {
        var deadline = Stopwatch.StartNew();

        while (deadline.Elapsed < timeout)
        {
            if (Started.Any(p => p.HasExited))
            {
                throw new InvalidOperationException(
                    name + " exited during startup.");
            }

            if (PortOpen(port))
                return;

            await Task.Delay(150);
        }

        throw new TimeoutException(
            name + " did not start within " +
            timeout.TotalSeconds + " seconds.");
    }

    private static async Task WaitForApiAsync(TimeSpan timeout)
    {
        var deadline = Stopwatch.StartNew();

        while (deadline.Elapsed < timeout)
        {
            if (Started.Any(p => p.HasExited))
            {
                throw new InvalidOperationException(
                    "The Project Snow backend exited during startup. " +
                    "See Logs/syndicate-backend.log.");
            }

            if (await IsUpAsync())
                return;

            await Task.Delay(250);
        }

        throw new TimeoutException(
            "The Project Snow backend did not become ready within " +
            timeout.TotalSeconds + " seconds.");
    }

    /// <summary>
    /// Stops whatever process is listening on a port.
    /// </summary>
    private static void StopListener(
        int port,
        Action<string>? status)
    {
        try
        {
            var info = new ProcessStartInfo(
                "netstat.exe",
                "-ano -p tcp")
            {
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var netstat = Process.Start(info);

            if (netstat is null)
                return;

            string text = netstat.StandardOutput.ReadToEnd();

            netstat.WaitForExit(5000);

            foreach (var line in text.Split('\n'))
            {
                var parts = line.Split(
                    (char[]?)null,
                    StringSplitOptions.RemoveEmptyEntries);

                if (parts.Length < 5)
                    continue;

                if (!parts[1].EndsWith(
                    ":" + port,
                    StringComparison.Ordinal))
                {
                    continue;
                }

                if (!parts[3].Equals(
                    "LISTENING",
                    StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (!int.TryParse(parts[4], out int pid) || pid <= 4)
                    continue;

                try
                {
                    using var process = Process.GetProcessById(pid);

                    process.Kill(entireProcessTree: true);
                    process.WaitForExit(5000);

                    status?.Invoke(
                        "Stopped the old local service on port " +
                        port + ".");
                }
                catch { }
            }
        }
        catch { }
    }

    /// <summary>
    /// Stops only the processes this launcher started.
    /// </summary>
    public static void StopStarted()
    {
        foreach (var process in Started.ToArray().Reverse())
        {
            try
            {
                if (!process.HasExited)
                    process.Kill(entireProcessTree: true);
            }
            catch { }
        }

        Started.Clear();
        _startedSeason = -1;
    }
}
