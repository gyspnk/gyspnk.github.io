# Enhanced Shell Integration Script for GitHub Copilot
# This script provides rich context information for better AI assistance

param(
    [string]$Action = "context",
    [string]$Command = ""
)

function Get-DetailedContext {
    $context = @{
        Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Location = @{
            Path = (Get-Location).Path
            Drive = (Get-Location).Drive.Name
            Provider = (Get-Location).Provider.Name
        }
        System = @{
            PowerShellVersion = $PSVersionTable.PSVersion.ToString()
            OS = $env:OS
            Architecture = $env:PROCESSOR_ARCHITECTURE
            ComputerName = $env:COMPUTERNAME
            UserName = $env:USERNAME
            UserDomain = $env:USERDOMAIN
        }
        Environment = @{
            Path = $env:PATH -split ';' | Where-Object { $_ -ne '' } | Select-Object -First 10
            PowerShellModulePath = $env:PSModulePath -split ';' | Where-Object { $_ -ne '' }
            TempPath = $env:TEMP
            HomePath = $env:USERPROFILE
        }
    }
    
    # Add file system context
    $files = Get-ChildItem -Force -ErrorAction SilentlyContinue | Select-Object -First 20
    $context.Files = @{
        Count = $files.Count
        Types = $files | Group-Object Extension | Select-Object Name, Count
        RecentFiles = $files | Sort-Object LastWriteTime -Descending | Select-Object -First 5 | Select-Object Name, LastWriteTime, Length
    }
    
    # Add Git context if available
    try {
        if (Test-Path .git -PathType Container) {
            $gitBranch = git rev-parse --abbrev-ref HEAD 2>$null
            $gitStatus = git status --porcelain 2>$null
            $gitRemote = git config --get remote.origin.url 2>$null
            
            $context.Git = @{
                Branch = $gitBranch
                Status = $gitStatus
                Remote = $gitRemote
                HasChanges = ($gitStatus -ne $null -and $gitStatus.Length -gt 0)
            }
        }
    } catch {
        # Git not available or not a git repository
    }
    
    # Add process context
    $context.Processes = @{
        PowerShellProcesses = Get-Process PowerShell* | Select-Object Name, Id, CPU, WorkingSet
        VSCodeProcesses = Get-Process Code* -ErrorAction SilentlyContinue | Select-Object Name, Id, CPU, WorkingSet
        RunningServices = Get-Service | Where-Object Status -eq 'Running' | Select-Object -First 10 | Select-Object Name, Status
    }
    
    # Add network context
    try {
        $context.Network = @{
            Connectivity = Test-NetConnection 8.8.8.8 -InformationLevel Quiet
            LocalIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object PrefixOrigin -eq 'Dhcp' | Select-Object -First 1).IPAddress
        }
    } catch {
        $context.Network = @{ Status = "Unable to determine" }
    }
    
    # Add PowerShell module context
    $context.PowerShell = @{
        LoadedModules = Get-Module | Select-Object Name, Version, ModuleType
        AvailableModules = Get-Module -ListAvailable | Select-Object -First 10 | Select-Object Name, Version
        ExecutionPolicy = Get-ExecutionPolicy
        History = Get-History | Select-Object -Last 10 | Select-Object Id, CommandLine, StartExecutionTime
    }
    
    return $context
}

function Get-CommandSuggestions {
    param([string]$PartialCommand)
    
    $suggestions = @{
        Commands = @()
        Aliases = @()
        Functions = @()
        ProjectSpecific = @()
    }
    
    # Get matching commands
    $suggestions.Commands = Get-Command "*$PartialCommand*" -ErrorAction SilentlyContinue | 
                           Select-Object Name, CommandType, Source | 
                           Sort-Object Name | 
                           Select-Object -First 15
    
    # Get matching aliases
    $suggestions.Aliases = Get-Alias "*$PartialCommand*" -ErrorAction SilentlyContinue |
                          Select-Object Name, Definition |
                          Sort-Object Name |
                          Select-Object -First 10
    
    # Get matching functions
    $suggestions.Functions = Get-Command -CommandType Function "*$PartialCommand*" -ErrorAction SilentlyContinue |
                            Select-Object Name, Source |
                            Sort-Object Name |
                            Select-Object -First 10
    
    # Project-specific suggestions
    if (Test-Path "package.json") {
        $suggestions.ProjectSpecific += @("npm install", "npm start", "npm test", "npm run dev", "npm run build")
    }
    if (Test-Path "*.py") {
        $suggestions.ProjectSpecific += @("python -m venv venv", "pip install -r requirements.txt", "python app.py")
    }
    if (Test-Path "index.html") {
        $suggestions.ProjectSpecific += @("python -m http.server 8000", "live-server", "npx serve")
    }
    if (Test-Path ".git") {
        $suggestions.ProjectSpecific += @("git status", "git add .", "git commit -m", "git push", "git pull")
    }
    
    return $suggestions
}

function Show-ShellIntegrationHelp {
    Write-Host "Enhanced Shell Integration for GitHub Copilot" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Available Commands:" -ForegroundColor Yellow
    Write-Host "  .\shell-integration.ps1 context        - Get detailed environment context" -ForegroundColor Cyan
    Write-Host "  .\shell-integration.ps1 suggest <cmd>  - Get command suggestions" -ForegroundColor Cyan
    Write-Host "  .\shell-integration.ps1 help           - Show this help" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Profile Functions:" -ForegroundColor Yellow
    Write-Host "  Get-ShellContext                       - Get JSON context for AI" -ForegroundColor Cyan
    Write-Host "  Get-ProjectCommands                     - Get project-specific commands" -ForegroundColor Cyan
    Write-Host "  Get-CommandSuggestions <partial>       - Get command suggestions" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Enhanced Features:" -ForegroundColor Yellow
    Write-Host "  • Predictive IntelliSense" -ForegroundColor White
    Write-Host "  • Git branch in prompt" -ForegroundColor White
    Write-Host "  • Project type detection" -ForegroundColor White
    Write-Host "  • Command history search" -ForegroundColor White
    Write-Host "  • Context-aware suggestions" -ForegroundColor White
}

# Main script logic
switch ($Action.ToLower()) {
    "context" {
        $context = Get-DetailedContext
        $context | ConvertTo-Json -Depth 5 | Write-Output
    }
    "suggest" {
        if ([string]::IsNullOrEmpty($Command)) {
            Write-Host "Please provide a command to get suggestions for." -ForegroundColor Red
            Write-Host "Usage: .\shell-integration.ps1 suggest <partial-command>" -ForegroundColor Yellow
        } else {
            $suggestions = Get-CommandSuggestions -PartialCommand $Command
            $suggestions | ConvertTo-Json -Depth 3 | Write-Output
        }
    }
    "help" {
        Show-ShellIntegrationHelp
    }
    default {
        Write-Host "Unknown action: $Action" -ForegroundColor Red
        Show-ShellIntegrationHelp
    }
}