"""Shared database in one step: from the multimedia folder, `python setup.py` creates the database, its tables and the demo data.

Works with any Python: the first run makes database/.venv with the MySQL driver, then every run uses it for database/setup.py --seed.
"""

import subprocess
import sys
from pathlib import Path

DATABASE = Path(__file__).resolve().parent / "database"
VENV = DATABASE / ".venv"
VENV_PYTHON = VENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")

if not VENV_PYTHON.exists():
    print("First run: installing the MySQL driver into database/.venv ...")
    if subprocess.run([sys.executable, "-m", "venv", str(VENV)]).returncode or subprocess.run(
        [str(VENV_PYTHON), "-m", "pip", "install", "-q", "-r", str(DATABASE / "requirements.txt")]
    ).returncode:
        sys.exit("Couldn't install the MySQL driver; see the message above.")

sys.exit(subprocess.run([str(VENV_PYTHON), str(DATABASE / "setup.py"), "--seed"]).returncode)
