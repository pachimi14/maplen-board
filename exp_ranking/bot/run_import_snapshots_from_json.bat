@echo off
setlocal
cd /d "%~dp0"

echo.
echo  Import ranking snapshots from rankings.json into SQLite
echo  (Use when DB has 1 day but local JSON still has 2+ days of history)
echo.

set "SQLITE_DB_PATH=data\ranking.db"
set "IMPORT_SNAPSHOTS_JSON=data\seed\rankings_seed.json"
set "MVP_JSON_OUTPUT_PATH=../web/public/data/rankings.json"

python -c "from config import load_env_file, sqlite_db_path, resolve_snapshot_import_path; from sqlite_storage import count_snapshot_dates, import_snapshots_from_mvp_json, init_db; load_env_file(); p=sqlite_db_path(); init_db(p); before=count_snapshot_dates(p); path=resolve_snapshot_import_path(p); assert path, 'no seed to import'; n=import_snapshots_from_mvp_json(p, path); after=count_snapshot_dates(p); print(f'days {before} -> {after}, imported_rows={n}, source={path}')"

if errorlevel 1 (
    echo [FAILED]
    exit /b 1
)

echo.
echo  Re-export JSON:
call run_export_mvp_json_manual.bat
echo [OK] Done.
endlocal
