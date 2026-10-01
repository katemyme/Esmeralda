<#
.SYNOPSIS
  Recrea la BD de prueba desde cero y ejecuta todas las pruebas (versión Windows de probar.sh).

.DESCRIPTION
  Borra y crea la base esmeralda_test, carga 01_esquema + 02_seed + 03_datos_demo
  y corre 04_pruebas.sql, mostrando solo el resultado de cada prueba.

  Uso (desde la raíz del repositorio):
    powershell -ExecutionPolicy Bypass -File db\scripts\probar.ps1
    db\scripts\probar.cmd                      (lo mismo, desde cmd o doble clic)

  Contraseña: se toma de %APPDATA%\postgresql\pgpass.conf o de PGPASSWORD;
  si no hay ninguna, se pide una sola vez. El usuario debe ser superusuario
  (por defecto postgres): crea la base y fija lc_messages.
  psql: se busca en el PATH y, si no está, en C:\Program Files\PostgreSQL\<versión>\bin.
#>
param(
  [string]$Servidor  = $(if ($env:PGHOST) { $env:PGHOST } else { 'localhost' }),
  [int]   $Puerto    = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }),
  [string]$Usuario   = $(if ($env:PGUSER) { $env:PGUSER } else { 'postgres' }),
  [string]$BaseDatos = 'esmeralda_test'
)

$ErrorActionPreference = 'Stop'
$DIR = Split-Path -Parent $PSScriptRoot          # carpeta db/

# Esta base se borra completa: solo se aceptan nombres de prueba
if ($BaseDatos -notmatch '^[a-z_][a-z0-9_]*_test$') {
  Write-Host "Nombre de base no permitido: '$BaseDatos' (debe terminar en _test)" -ForegroundColor Red
  exit 2
}

function Buscar-Psql {
  $cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $instalado = Get-ChildItem "$env:ProgramFiles\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending |
    Select-Object -First 1
  if ($instalado) { return $instalado.FullName }
  Write-Host 'No se encontró psql.exe. Instale PostgreSQL o agregue su carpeta bin al PATH.' -ForegroundColor Red
  exit 2
}

# Ejecuta psql y devuelve stdout + stderr como texto, en el orden en que llegan
function Invocar-Psql([string[]]$argumentos) {
  $previo = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'         # en PS 5.1, stderr redirigido no debe abortar el script
  try {
    & $script:psql -X -w -h $Servidor -p $Puerto -U $Usuario @argumentos 2>&1 | ForEach-Object { "$_" }
  } finally {
    $ErrorActionPreference = $previo
  }
}

$psql = Buscar-Psql

# Los .sql están en UTF-8; la consola de Windows usa otra página de códigos por defecto
$codificacionPrevia = [Console]::OutputEncoding
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:PGCLIENTENCODING = 'UTF8'

$pgpass = if ($env:PGPASSFILE) { $env:PGPASSFILE } else { Join-Path $env:APPDATA 'postgresql\pgpass.conf' }
$pedimosClave = -not $env:PGPASSWORD -and -not (Test-Path $pgpass)
if ($pedimosClave) {
  $segura = Read-Host "Contraseña de PostgreSQL para '$Usuario'" -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura))
}

try {
  Write-Host "psql: $psql"
  Write-Host "Recreando la base $BaseDatos en ${Servidor}:$Puerto ..."
  # lc_messages = C: mensajes del sistema en inglés, como en el servidor Linux
  # (las pruebas comparan textos como "duplicate key"; un PostgreSQL en español diría "llave duplicada")
  $salida = Invocar-Psql @('-q', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
                           '-c', "drop database if exists $BaseDatos with (force)",
                           '-c', "create database $BaseDatos",
                           '-c', "alter database $BaseDatos set lc_messages = 'C'")
  if ($LASTEXITCODE -ne 0) { $salida | Write-Host; throw 'No se pudo recrear la base de prueba' }

  foreach ($f in '01_esquema', '02_seed', '03_datos_demo') {
    Write-Host "Cargando $f.sql ..."
    $salida = Invocar-Psql @('-q', '-d', $BaseDatos, '-v', 'ON_ERROR_STOP=1', '-f', (Join-Path $DIR "$f.sql"))
    if ($LASTEXITCODE -ne 0) { $salida | Write-Host; throw "Falló la carga de $f.sql" }
  }

  Write-Host 'Ejecutando 04_pruebas.sql ...'
  $salida = Invocar-Psql @('-d', $BaseDatos, '-f', (Join-Path $DIR '04_pruebas.sql'))
  $codigo = $LASTEXITCODE

  $flecha = [char]0x2192
  foreach ($linea in $salida) {
    if ($linea -cmatch "OK  $flecha|FALLO|ERROR|===|PASARON") {      # -cmatch: distingue mayúsculas, como grep
      if ($linea -match 'LBR-MANUAL') { $linea += '   <- esperado: prueba del trigger diferido' }
      Write-Host $linea
    }
  }

  $ok = @($salida | Where-Object { $_ -cmatch "OK  $flecha" }).Count
  $pasaron = @($salida | Where-Object { $_ -cmatch 'TODAS LAS PRUEBAS PASARON' }).Count -gt 0
  Write-Host ''
  if ($codigo -eq 0 -and $pasaron) {
    Write-Host "Resultado: $ok pruebas OK" -ForegroundColor Green
    exit 0
  }
  Write-Host "Resultado: FALLARON las pruebas ($ok OK antes de detenerse, código psql $codigo)" -ForegroundColor Red
  exit 1
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
} finally {
  [Console]::OutputEncoding = $codificacionPrevia
  if ($pedimosClave) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}
