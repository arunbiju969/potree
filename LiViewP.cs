using System;
using System.Diagnostics;
using System.IO;

namespace LiViewLauncher
{
    internal static class Program
    {
        private static int Main()
        {
            try
            {
                var baseDir = AppContext.BaseDirectory;
                var targetDir = Path.Combine(baseDir, "examples", "electron-app");

                if (!Directory.Exists(targetDir))
                {
                    targetDir = Path.Combine(baseDir, "potree", "examples", "electron-app");
                }

                if (!Directory.Exists(targetDir))
                {
                    Console.Error.WriteLine("Electron app directory not found: " + targetDir);
                    return 1;
                }

                var startInfo = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c npm start",
                    WorkingDirectory = targetDir,
                    UseShellExecute = false,
                    RedirectStandardInput = false,
                    RedirectStandardOutput = false,
                    RedirectStandardError = false,
                    CreateNoWindow = false
                };

                Process process = Process.Start(startInfo);
                if (process == null)
                {
                    Console.Error.WriteLine("Failed to start npm process.");
                    return 1;
                }

                process.WaitForExit();
                int exitCode = process.ExitCode;
                process.Dispose();
                return exitCode;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.ToString());
                return 1;
            }
        }
    }
}
