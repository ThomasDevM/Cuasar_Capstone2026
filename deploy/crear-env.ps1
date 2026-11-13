# Crea el archivo .env con claves seguras generadas al azar y guarda las claves iniciales en CLAVES-INICIALES.txt
$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function Hex([int]$n) { $b = New-Object byte[] $n; $rng.GetBytes($b); ($b | ForEach-Object { $_.ToString("x2") }) -join "" }
function Clave([int]$n) {
  $c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; $b = New-Object byte[] $n; $rng.GetBytes($b)
  -join ($b | ForEach-Object { $c[$_ % $c.Length] })
}
$valores = @{ DB_PASSWORD = (Hex 16); JWT_SECRET = (Hex 48); ADMIN_PASSWORD = (Clave 12); PROFESIONAL_PASSWORD = (Clave 12) }
$lineas = Get-Content (Join-Path $raiz ".env.example") | ForEach-Object {
  $l = $_
  foreach ($k in $valores.Keys) { if ($l -match "^$k=") { $l = "$k=" + $valores[$k] } }
  $l
}
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines((Join-Path $raiz ".env"), $lineas, $utf8)
$texto = @(
  "CLAVES INICIALES - Deva Aesthetic House",
  "(Guarde este archivo en un lugar seguro y cambie estas claves al ingresar por primera vez)",
  "",
  "Direccion (Sandra):   usuario: sandra         clave: " + $valores.ADMIN_PASSWORD,
  "Profesional:          usuario: profesional    clave: " + $valores.PROFESIONAL_PASSWORD + "   (debe cambiarla al primer ingreso)",
  "",
  "Direccion de acceso:  http://localhost:3000"
)
[System.IO.File]::WriteAllLines((Join-Path $raiz "CLAVES-INICIALES.txt"), $texto, $utf8)
Write-Host "Configuracion creada. Las claves iniciales estan en CLAVES-INICIALES.txt"
