-- Das Kandidatenprotokoll ist ein Beweisstück für den Vorwärts-Paper-Betrieb: einmal geschrieben, nie geändert oder gelöscht.
CREATE TRIGGER candidate_log_no_update BEFORE UPDATE ON candidate_log BEGIN SELECT RAISE(ABORT, 'candidate_log ist unveränderlich'); END;
CREATE TRIGGER candidate_log_no_delete BEFORE DELETE ON candidate_log BEGIN SELECT RAISE(ABORT, 'candidate_log ist unveränderlich'); END;
