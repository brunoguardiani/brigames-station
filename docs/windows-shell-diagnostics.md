# Windows shell freezes

The application registers no global keyboard shortcuts. Alt+Tab is handled by
Windows. A shell freeze therefore needs a snapshot of the Windows UI threads,
not only renderer logs or a successful application build.

Tray activation is deferred until the native event dispatch finishes. Repeated
activation requests in the same event-loop turn are combined, and `show()` gives
the window focus without a redundant `focus()` call. Closing to the background
also defers minimization until after native close dispatch. These changes reduce
unnecessary native transitions; they do not establish the cause of a shell hang.

While the problem is occurring, before restarting Explorer or exiting Brigames,
run from the repository root:

```powershell
powershell.exe -NoProfile -File apps/desktop/scripts/collect-windows-shell-diagnostics.ps1
```

The script writes three snapshots to `apps/desktop/out/windows-shell-diagnostics`:
Windows/GPU versions, process resource counts, top-level Brigames and shell
windows, bounded `WM_NULL` response checks, GUI capture/menu/move state, and wait
chains for their window threads. It does not change focus, restart processes,
send keyboard input, or collect window titles or command lines. Some processes
or wait chains may require an elevated PowerShell; denied reads are reported as
warnings or wait-chain error codes. A single-node wait chain does not exclude
a hang on a synchronization mechanism unsupported by Windows WCT.

Compare a healthy report with the report captured during a freeze. An unanswered
window message alone is not conclusive: error 5 can indicate insufficient access.
Wait-chain node type 2 is SendMessage, type 8 is a thread, status 3 is blocked, and
`Deadlock` indicates a cycle detected by WCT. GUI flags can identify a menu or a
move/resize loop that persists across samples.

Manual validation: minimize and reopen from the tray, close to the background,
double-click the tray icon, and switch with Alt+Tab. Repeat while sharing a game
window and while only in a voice call. Record whether fully exiting Brigames
releases the shell, or whether Explorer must be restarted. These checks still
need to be performed on a session that reproduces the reported freeze.

References: [Electron window visibility and focus](https://www.electronjs.org/docs/latest/api/browser-window#winshow),
[GUI thread state](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-guithreadinfo),
[Windows wait chains](https://learn.microsoft.com/en-us/windows/win32/api/wct/nf-wct-getthreadwaitchain).
