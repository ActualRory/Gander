$env:PATH = $env:PATH + ';C:\Users\Rory\.rd\bin'
& 'C:\Program Files\Rancher Desktop\resources\resources\win32\bin\docker.exe' compose -f "$PSScriptRoot\docker-compose.dev.yml" up -d
