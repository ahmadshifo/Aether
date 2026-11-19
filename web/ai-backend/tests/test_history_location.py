"""Location contract and additive schema migration; live MySQL is checked separately."""
import unittest
import uuid
from datetime import datetime, UTC
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from pydantic import ValidationError
from app import history, routes
from app.auth import signed_in_user_id
from app.history_location import HistoryLocation
from app.main import app


PLACE = {"label": "Beirut, Chiyah", "captured_at": "2026-11-15T12:00:00Z"}


class LocationTests(unittest.TestCase):
    def test_validation_and_unicode(self):
        for label in ["Beirut, Chiyah", "بيروت، الشياح", "Paris, Montmartre"]:
            self.assertEqual(HistoryLocation(**{**PLACE, "label": label}).label, label)
        for place in [{**PLACE, "latitude": 33}, {**PLACE, "label": " "}, {**PLACE, "label": "A\nB"},
                      {**PLACE, "label": "x" * 161}, {**PLACE, "captured_at": "2026-11-15T12:00:00"}]:
            with self.assertRaises(ValidationError):
                HistoryLocation(**place)

    def test_an_old_row_without_a_place_has_no_made_up_place(self):
        row = {"question_id": "q", "session_id": "s", "asked_at": datetime(2026, 11, 18, 12, 0), "question": "?", "answer": ".",
               "language": "en", "uncertain": 0, "evidence_frame_ids": "[]"}
        record = history._record(row)
        self.assertIsNone(record["location"])
        self.assertFalse(record["demo"])

    def test_schema_only_adds_missing_nullable_columns(self):
        connection, cursor = MagicMock(), MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        cursor.fetchall.side_effect = [[], [{"COLUMN_NAME": "location_label"}, {"COLUMN_NAME": "location_captured_at"}]]
        with patch.object(history, "_connect", return_value=connection):
            history.init_history_table()
            history.init_history_table()
        alterations = [call.args[0] for call in cursor.execute.call_args_list if call.args[0].startswith("ALTER")]
        self.assertEqual(len(alterations), 2)
        self.assertTrue(all(" NULL" in query and "ADD COLUMN" in query for query in alterations))
        self.assertFalse(any(call.args[0].startswith(("DELETE", "UPDATE", "DROP")) for call in cursor.execute.call_args_list))

    def test_capture_time_is_stored_as_utc(self):
        connection, cursor = MagicMock(), MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        place = HistoryLocation(label="Beirut, Baabda", captured_at="2026-11-15T14:00:00+02:00")
        with patch.object(history, "_connect", return_value=connection):
            history.record_question(str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()), "Q", "A", "en", False, [], location=place)
        args = cursor.execute.call_args.args[1]
        self.assertEqual(args[-2:], (place.label, datetime(2026, 11, 15, 12)))

    def test_ask_is_backward_compatible_and_carries_place_to_storage(self):
        client = TestClient(app)  # no lifespan / no database in this unit test
        app.dependency_overrides[signed_in_user_id] = lambda: "user"
        app.dependency_overrides[routes.memory_client] = lambda: SimpleNamespace()
        try:
            for location in [None, PLACE]:
                request = {"session_id": str(uuid.uuid4()), "question_id": str(uuid.uuid4()), "question": "Read the sign", "language": "en"}
                if location: request["location"] = location
                saved = {"answer": "A sign", "language": "en", "uncertain": False, "evidence_frame_ids": [], "location": location}
                with patch.object(routes, "get_question", side_effect=[None, saved]), patch.object(routes, "_check_session_owner"), \
                     patch.object(routes.assistant, "answer", return_value=SimpleNamespace(text="A sign", uncertain=False, evidence_frame_ids=[])), \
                     patch.object(routes, "record_question") as save:
                    result = client.post("/api/v1/ask", json=request)
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json()["location"], location)
                self.assertEqual(save.call_args.kwargs["location"], HistoryLocation(**PLACE) if location else None)
            with patch.object(routes, "get_question") as lookup:
                bad = client.post("/api/v1/ask", json={**request, "location": {**PLACE, "longitude": 35}})
                self.assertEqual(bad.status_code, 422)
                lookup.assert_not_called()
        finally:
            app.dependency_overrides.clear()
            client.close()

    def test_retry_after_moving_keeps_original_location(self):
        saved = {"answer": "First answer", "language": "en", "uncertain": False, "evidence_frame_ids": [], "location": PLACE}
        request = routes.AskRequest(session_id=uuid.uuid4(), question_id=uuid.uuid4(), question="Read the sign", language="en", location={**PLACE, "label": "Beirut, Baabda"})
        with patch.object(routes, "get_question", return_value=saved), patch.object(routes, "record_question") as save, patch.object(routes.assistant, "answer") as answer:
            response = routes.ask(request, "user", SimpleNamespace())
        self.assertEqual(response.location.label, "Beirut, Chiyah")
        save.assert_not_called(); answer.assert_not_called()

    def test_concurrent_retry_returns_the_winning_saved_area(self):
        saved = {"answer": "First answer", "language": "en", "uncertain": False, "evidence_frame_ids": [], "location": PLACE}
        request = routes.AskRequest(session_id=uuid.uuid4(), question_id=uuid.uuid4(), question="Read the sign", language="en", location={**PLACE, "label": "Beirut, Baabda"})
        with patch.object(routes, "get_question", side_effect=[None, saved]), patch.object(routes, "_check_session_owner"), \
             patch.object(routes, "record_question"), patch.object(routes.assistant, "answer", return_value=SimpleNamespace(text="Second answer", uncertain=False, evidence_frame_ids=[])):
            response = routes.ask(request, "user", SimpleNamespace())
        self.assertEqual(response.answer, "First answer")
        self.assertEqual(response.location.label, "Beirut, Chiyah")


if __name__ == "__main__":
    unittest.main()
