$input = @("protocol=https", "host=github.com", "") -join "`n"
$cred = ($input | git credential-manager get) -join "`n"
$user = if ($cred -match 'username=(.+)') { $Matches[1].Trim() } else { '' }
$pass = if ($cred -match 'password=(.+)') { $Matches[1].Trim() } else { '' }
if (-not $user -or -not $pass) {
  Write-Error 'Missing GitHub credentials'
  exit 1
}
$pair = "${user}:${pass}"
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$env:GIT_TERMINAL_PROMPT = '0'

# Clean junk files
if (Test-Path .\patch.txt) { Remove-Item .\patch.txt -Force }

git add -A
# keep dist/node_modules ignored
git -c user.name="earnfidotfun" -c user.email="earnfi03@gmail.com" commit -m "feat: v2.1.0 Human Actions, Seeker launch fields, and closeJob"

git -c credential.helper= -c "http.extraHeader=AUTHORIZATION: basic $b64" push origin main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

git tag v2.1.0
git -c credential.helper= -c "http.extraHeader=AUTHORIZATION: basic $b64" push origin v2.1.0
git status -sb
exit $LASTEXITCODE
