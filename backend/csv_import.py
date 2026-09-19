import csv
import io

MAX_BYTES = 10 * 1024 * 1024
MAX_ROWS = 100_000
MAX_COLUMNS = 100


def parse_csv(content: bytes) -> tuple[list[str], list[dict[str, str]]]:
    if len(content) > MAX_BYTES:
        raise ValueError("File exceeds the 10 MB limit.")
    try:
        source = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Save your CSV as UTF-8 and try again.") from exc
    if "\x00" in source:
        raise ValueError("The file contains invalid null characters.")
    try:
        reader = csv.reader(io.StringIO(source, newline=""), strict=True)
        columns = [column.strip() for column in next(reader, [])]
        if not columns or any(not column for column in columns):
            raise ValueError("The first row must contain a name for every column.")
        if len(columns) > MAX_COLUMNS:
            raise ValueError(f"Use no more than {MAX_COLUMNS} columns.")
        if len(set(columns)) != len(columns):
            raise ValueError("Column names must be unique.")
        rows = []
        for values in reader:
            if not values or all(not value.strip() for value in values):
                continue
            if len(values) != len(columns):
                raise ValueError(f"CSV line {reader.line_num} has {len(values)} fields; expected {len(columns)}.")
            rows.append(dict(zip(columns, values)))
            if len(rows) > MAX_ROWS:
                raise ValueError(f"Use no more than {MAX_ROWS:,} rows per upload.")
    except csv.Error as exc:
        raise ValueError(f"Invalid CSV: {exc}") from exc
    if not rows:
        raise ValueError("The CSV needs at least one data row.")
    return columns, rows
