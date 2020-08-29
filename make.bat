@echo off
setlocal

REM set target=--target wasm32-unknown-unknown
set target=

if "%1" equ "release" (goto Release) else (goto Debug)

:Release
echo Release Build:
set target_dir=.\target\wasm32-unknown-unknown\release
set out_dir=.\wasm\release
set cargo_args=--release %target%
goto Begin

:Debug
echo Debug Build:
set target_dir=.\target\wasm32-unknown-unknown\debug
set out_dir=.\wasm\debug
set cargo_args=%target%


:Begin
echo Running Cargo Build:
cargo build %cargo_args%
echo.

echo Running wasm-bindgen:
wasm-bindgen --out-dir %out_dir% --no-typescript --out-name client --target web %target_dir%\client.wasm
REM wasm-bindgen --out-dir %out_dir% --no-typescript --out-name service-worker --target no-modules %target_dir%\service_worker.wasm
echo.

echo Running wasm-opt:
wasm-opt wasm/**/*.wasm
echo.
