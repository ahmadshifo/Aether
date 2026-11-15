import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('table_setup', ROOT / 'mobile/native/scripts/prepare-team-history.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def test_all_upstream_feature_tables_use_compatible_foreign_keys():
    statements = list(setup.team_declarations(ROOT))
    assert len(statements) == 6
    for sql in statements:
        compatible = setup.compatible_table(sql, 'ascii', 'ascii_bin')
        assert compatible.count('CHARACTER SET ascii COLLATE ascii_bin') == 1
        assert compatible.replace(' CHARACTER SET ascii COLLATE ascii_bin', '') == sql
        assert 'CREATE TABLE IF NOT EXISTS' in compatible
        assert 'REFERENCES users (user_id)' in compatible


def test_existing_qualified_column_is_not_changed():
    sql = 'CREATE TABLE IF NOT EXISTS t (user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL)'
    assert setup.compatible_table(sql, 'ascii', 'ascii_bin') == sql


@pytest.mark.parametrize('charset,collation', [('ascii; DROP TABLE users', 'ascii_bin'), ('ascii', None)])
def test_rejects_unexpected_identifier(charset, collation):
    with pytest.raises(RuntimeError):
        setup.compatible_table('CREATE TABLE IF NOT EXISTS t (user_id CHAR(36) NOT NULL)', charset, collation)
