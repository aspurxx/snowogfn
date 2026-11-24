namespace SyndicateLauncher.Models;

public sealed record BotPreset(int Index)
{
    public static BotPreset Builtin(int index) => new(index);
    public string Argument() => Index.ToString();
}
