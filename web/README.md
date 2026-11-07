<!-- Member 2's guide: browser dashboard, AI orchestration, visual-grounded answers and question history. -->
# Member 2 - Web Dashboard and AI

Own `dashboard/` and `ai-backend/`. Use fixture search results until Member 3's service is ready, and a mock camera stream until Member 1 publishes video. Never access Member 3's database tables directly.


## Database-backed login and signup

The existing auth and stream routes use the shared MySQL tables initialized by
multimedia/database. Configure the ignored web/ai-backend/.env with the same
MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER and MYSQL_PASSWORD as
multimedia/api/.env, or let the backend fall back to that shared private file.
Keep a private JWT_SECRET for stable token signing across restarts. The local
setup uses the multimedia_project database. Database credentials are separate
from the email/password a person supplies at signup.

From the repository root, run:

```powershell
.\multimedia\.venv\Scripts\python.exe -m pip install -r web/ai-backend/requirements.txt
# Initialize tables from multimedia/ first; see its database README.
.\multimedia\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir web/ai-backend --host 127.0.0.1 --port 8002
```

The dashboard's existing Vite proxy connects to this backend on port 8002.
Run the frontend separately with its normal npm startup command.
