from backend.dashboard import tool_scrap


def job(good, scrap, tools=('t1',)):
    return dict(job_id=str(good), customer_id='c', timeline=[dict(event_type='tool_ready', metadata=dict(tool_id=t)) for t in tools] + [dict(event_type='job_completed', timestamp='2026-07-01T00:00:00Z', metadata=dict(good_quantity=good, scrap_quantity=scrap))])


def calc(jobs):
    return tool_scrap(dict(as_of='2026-07-02T00:00:00Z', quality={}), jobs)


def test_weighted_rate_and_ambiguous_associations():
    result = calc({'a': job(9, 1), 'b': job(50, 50), 'c': job(0, 0, ('t1', 't2'))})
    group = result['tools'][0]
    assert group['scrap_quantity'] == 51
    assert abs(group['scrap_rate'] - 51 / 110 * 100) < 1e-9
    assert result['tools'][1]['tool_id'] == 'Unknown / ambiguous'
    assert result['tools'][1]['scrap_rate'] is None


def test_latest_snapshot_missing_values_and_unfinished():
    entry = job(10, 2, ())
    entry['timeline'].append(dict(event_type='job_completed', timestamp='2026-07-02T00:00:00Z', metadata=dict(good_quantity=12, scrap_quantity=1)))
    result = calc({'a': entry, 'b': job(1, None), 'c': dict(timeline=[]), 'd': job(True, 1)})
    assert result['excluded_jobs'] == 2
    assert result['multiple_completions'] == 1
    assert result['tools'][0]['scrap_quantity'] == 1
    assert result['tools'][0]['tool_id'] == 'Unknown / ambiguous'
