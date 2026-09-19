import pytest

from backend.jsonl_import import parse_jsonl


def test_jsonl_preserves_types_duplicates_and_optional_fields():
    columns, rows = parse_jsonl(b'\xef\xbb\xbf{"event_id":"a","quantity":0,"metadata":{"ok":false,"tags":[1,null]}}\r\n\n{"event_id":"a","machine_id":null}\n')
    assert columns == ['event_id', 'quantity', 'metadata', 'machine_id']
    assert rows == [dict(event_id='a', quantity=0, metadata=dict(ok=False, tags=[1, None])), dict(event_id='a', machine_id=None)]


@pytest.mark.parametrize('line', [b'{', b'[]', b'null', b'{}', b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":1e999}', b'{"a":"\\u0000"}', b'{"a":"\\ud800"}'])
def test_invalid_jsonl_reports_source_line(line):
    with pytest.raises(ValueError, match='JSONL line 3:'):
        parse_jsonl(b'{"valid":true}\n\n' + line)


@pytest.mark.parametrize('content', [b'', b'\n \n', b'\xff'])
def test_empty_or_non_utf8_jsonl_rejected(content):
    with pytest.raises(ValueError):
        parse_jsonl(content)
