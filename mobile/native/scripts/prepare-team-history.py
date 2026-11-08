"""Create the team's missing History table with a compatible account foreign key.

The current backend DDL leaves user_id in the database default collation, while
the multimedia account schema uses ascii_bin. Existing tables are never altered.
Remove this bootstrap after the backend owner fixes QUESTION_TABLE upstream.
"""
import ast
import os
from pathlib import Path
import re
import pymysql


def main():
    repo = Path(__file__).resolve().parents[3]
    tree = ast.parse((repo / 'web/ai-backend/app/history.py').read_text(encoding='utf-8'))
    declaration = next(node for node in tree.body if isinstance(node, ast.Assign)
                       and any(isinstance(name, ast.Name) and name.id == 'QUESTION_TABLE' for name in node.targets))
    sql = ast.literal_eval(declaration.value)
    with pymysql.connect(host=os.environ['MYSQL_HOST'], port=int(os.environ['MYSQL_PORT']),
                         user=os.environ['MYSQL_USER'], password=os.environ['MYSQL_PASSWORD'],
                         database=os.environ['MYSQL_DATABASE'], charset='utf8mb4', autocommit=True) as db:
        with db.cursor() as cursor:
            cursor.execute('SELECT CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS '
                           'WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s AND COLUMN_NAME=%s', ('users', 'user_id'))
            charset, collation = cursor.fetchone()
            if not all(re.fullmatch(r'[a-zA-Z0-9_]+', part or '') for part in (charset, collation)):
                raise RuntimeError('Unsupported account identifier character set.')
            # Only the unqualified column in the known team declaration needs adaptation.
            sql = re.sub(r'(\buser_id\s+CHAR\(36\))(?=\s+NOT NULL)',
                         lambda match: f'{match[1]} CHARACTER SET {charset} COLLATE {collation}', sql, count=1)
            cursor.execute(sql)
    print('Team History table is available; existing data was preserved.')


if __name__ == '__main__':
    main()
