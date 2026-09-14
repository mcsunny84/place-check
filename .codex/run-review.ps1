# Waits until codex quota reset (23:47), then runs the code review (Astra). -o goes to a separate file.
$codex = 'C:\Users\Design\AppData\Local\OpenAI\Codex\bin\bffc5354119c8421\codex.exe'
$root = 'C:\Users\Design\Dev\claudecode\place-check'
$prompt = "$root\.codex\code-review-prompt.txt"
$log = "$root\.codex\code-review.log"
$target = (Get-Date -Hour 2 -Minute 50 -Second 0); if ((Get-Date) -gt $target) { $target = $target.AddDays(1) }
if ((Get-Date) -lt $target) { Start-Sleep -Seconds ([int](($target - (Get-Date)).TotalSeconds)) }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Set-Location $root
"start $(Get-Date -Format s)" | Out-File -FilePath $log -Encoding utf8
Get-Content -Raw -Encoding UTF8 $prompt | & $codex exec -m gpt-6-astra -s workspace-write --skip-git-repo-check -o "$root\.codex\code-review-last.md" - 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
"end $(Get-Date -Format s) exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8
