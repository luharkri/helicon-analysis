from backend.dashboard import parts


def test_part_grouping_weighted_rate_and_ambiguous_ids():
    def job(identifier, ids, good, scrap):
        return dict(job_id=identifier, customer_id='customer', timeline=[dict(event_type='job_started', part_id=p) for p in ids] + [dict(event_type='job_completed', timestamp='2026-07-01T00:00:00Z', metadata=dict(good_quantity=good, scrap_quantity=scrap))])
    result = parts(dict(as_of='2026-07-01T00:00:00Z', quality={}), {
        'a': job('a', ['p1'], 9, 1), 'b': job('b', ['p1'], 50, 50),
        'c': job('c', ['p1', 'p2'], 0, 0), 'd': job('d', [], 1, None),
    })
    assert result['excluded_jobs'] == 1
    group = result['parts'][0]
    assert group['part_id'] == 'p1'
    assert group['good_quantity'] == 59
    assert group['scrap_quantity'] == 51
    assert group['scrap_rate'] == 100 * 51 / 110
    assert len(group['jobs']) == 2
    assert result['parts'][1]['part_id'] == 'Unknown / ambiguous'
    assert result['parts'][1]['scrap_rate'] is None
