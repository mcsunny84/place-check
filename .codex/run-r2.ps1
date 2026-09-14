# Waits until codex quota reset, then runs the R2 adversarial review (Astra).
$codex = 'C:\Users\Design\AppData\Local\OpenAI\Codex\bin\bffc5354119c8421\codex.exe'
$docs = 'C:\Users\Design\Dev\claudecode\place-check\docs'
$prompt = 'C:\Users\Design\Dev\claudecode\place-check\.codex\r2-prompt.txt'
$log = 'C:\Users\Design\Dev\claudecode\place-check\.codex\r2.log'
$target = Get-Date -Hour 21 -Minute 23 -Second 0
if ((Get-Date) -lt $target) { Start-Sleep -Seconds ([int](($target - (Get-Date)).TotalSeconds)) }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Set-Location $docs
"start $(Get-Date -Format s)" | Out-File -FilePath $log -Encoding utf8
Get-Content -Raw -Encoding UTF8 $prompt | & $codex exec -m gpt-6-astra -s workspace-write --skip-git-repo-check -o "$docs\03_GPT_판정_02_v0.4.md" - 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
"end $(Get-Date -Format s) exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8
