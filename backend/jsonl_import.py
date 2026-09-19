import json
import math

from backend.csv_import import MAX_BYTES, MAX_COLUMNS, MAX_ROWS


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'Duplicate JSON key: {key}.')
        result[key] = value
    return result


def _validate(value):
    if isinstance(value, str):
        if '\x00' in value:
            raise ValueError('Null characters cannot be stored in Postgres.')
        value.encode('utf-8')
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError('Numbers must be finite.')
    elif isinstance(value, dict):
        for key, item in value.items():
            _validate(key)
            _validate(item)
    elif isinstance(value, list):
        for item in value:
            _validate(item)


def parse_jsonl(content: bytes) -> tuple[list[str], list[dict]]:
    if len(content) > MAX_BYTES:
        raise ValueError('File exceeds the 10 MB limit.')
    try:
        source = content.decode('utf-8-sig')
    except UnicodeDecodeError as exc:
        raise ValueError('Save your JSONL as UTF-8 and try again.') from exc
    columns = {}
    rows = []
    for line_number, line in enumerate(source.split('\n'), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line, object_pairs_hook=_object)
            if not isinstance(row, dict) or not row:
                raise ValueError('Each line must contain a nonempty JSON object.')
            _validate(row)
        except (ValueError, RecursionError) as exc:
            raise ValueError(f'JSONL line {line_number}: {exc}') from exc
        columns.update(dict.fromkeys(row))
        if len(columns) > MAX_COLUMNS:
            raise ValueError(f'Use no more than {MAX_COLUMNS} top-level fields.')
        rows.append(row)
        if len(rows) > MAX_ROWS:
            raise ValueError(f'Use no more than {MAX_ROWS:,} rows per upload.')
    if not rows:
        raise ValueError('The JSONL needs at least one record.')
    return list(columns), rows
