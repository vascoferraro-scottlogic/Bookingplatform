# Loads .env from workspace root then launches the GitHub MCP server
$envFile = Join-Path $PSScriptRoot "../.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^#=\s]+)\s*=\s*"?([^"]*)"?\s*$') {
            [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2])
        }
    }
}
npx -y @modelcontextprotocol/server-github
