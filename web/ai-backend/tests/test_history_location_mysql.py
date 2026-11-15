"""Opt-in real MySQL integration: AETHER_MYSQL_INTEGRATION=1 with MYSQL_* configured.

Uses two temporary accounts, removes only their records, and leaves existing data intact.
The additive location migration is deliberately retained. AI responses are stubbed.
"""
import os
import unittest
import uuid
from contextlib import closing
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from app import history, routes
from app.auth import _connect, _now, signed_in_user_id
from app.main import app


@unittest.skipUnless(os.getenv("AETHER_MYSQL_INTEGRATION") == "1", "requires explicit real MySQL integration opt-in")
class MySQLHistoryLocationTests(unittest.TestCase):
    def test_migration_roundtrip_movement_retry_isolation_and_clear(self):
        # Snapshot existing rows without logging their content; the migration must preserve them.
        columns = "question_id, user_id, session_id, asked_at, question, answer, language, uncertain, evidence_frame_ids"
        with closing(_connect()) as conn, conn.cursor() as cur:
            cur.execute(f"SELECT {columns} FROM questions ORDER BY question_id")
            before = cur.fetchall()
        history.init_history_table(); history.init_history_table()
        with closing(_connect()) as conn, conn.cursor() as cur:
            cur.execute(f"SELECT {columns} FROM questions ORDER BY question_id")
            self.assertEqual(cur.fetchall(), before)
        users = [str(uuid.uuid4()), str(uuid.uuid4())]
        active = [users[0]]
        client = TestClient(app)
        try:
            with closing(_connect()) as conn, conn.cursor() as cur:
                for user in users:
                    cur.execute("INSERT INTO users (user_id, email, name, password_hash, created_at) VALUES (%s,%s,%s,%s,%s)",
                                (user, f"location-test-{user}@example.invalid", "Location integration test", "disabled-test-account", _now()))
            app.dependency_overrides[signed_in_user_id] = lambda: active[0]
            app.dependency_overrides[routes.memory_client] = lambda: SimpleNamespace()
            session = str(uuid.uuid4()); requests = []
            with patch.object(routes.assistant, "answer", return_value=SimpleNamespace(text="Synthetic location test answer", uncertain=False, evidence_frame_ids=[])):
                for label in ["Beirut, Chiyah", "بيروت، بعبدا", None]:
                    payload = {"session_id": session, "question_id": str(uuid.uuid4()), "question": "Where is the door?", "language": "en"}
                    if label: payload["location"] = {"label": label, "captured_at": _now().isoformat() + "Z"}
                    requests.append(payload)
                    response = client.post("/api/v1/ask", json=payload)
                    self.assertEqual(response.status_code, 200, response.text)
                retry = client.post("/api/v1/ask", json={**requests[0], "location": {**requests[0]["location"], "label": "Moved elsewhere"}})
                self.assertEqual(retry.json()["location"]["label"], "Beirut, Chiyah")
            # New HTTP client / no phone cache: metadata must come back from MySQL.
            fresh = TestClient(app)
            try:
                result = fresh.get("/api/v1/questions").json()
            finally:
                fresh.close()
            by_id = {row["question_id"]: row for row in result["questions"]}
            self.assertEqual(len(by_id), 3)
            self.assertEqual(by_id[requests[0]["question_id"]]["location"]["label"], "Beirut, Chiyah")
            self.assertEqual(by_id[requests[1]["question_id"]]["location"]["label"], "بيروت، بعبدا")
            self.assertIsNone(by_id[requests[2]["question_id"]]["location"])
            active[0] = users[1]
            self.assertTrue(client.get("/api/v1/questions").json()["demo"])
            self.assertEqual(client.delete("/api/v1/questions").json()["deleted"], 0)
            active[0] = users[0]
            self.assertEqual(client.delete("/api/v1/questions").json()["deleted"], 3)
            self.assertTrue(client.get("/api/v1/questions").json()["demo"])
        finally:
            app.dependency_overrides.clear(); client.close()
            with closing(_connect()) as conn, conn.cursor() as cur:
                for user in users:
                    cur.execute("DELETE FROM users WHERE user_id = %s AND email = %s", (user, f"location-test-{user}@example.invalid"))


if __name__ == "__main__":
    unittest.main()
