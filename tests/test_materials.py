from backend.dashboard import materials


def entry(name, good, scrap):
    return dict(job_id=str(good), customer_id='c', timeline=[dict(event_type='job_completed', timestamp='2026-07-01T00:00:00Z', material=name, metadata=dict(good_quantity=good, scrap_quantity=scrap))])


def test_material_totals_weighted_rates_and_invalid_values():
    result = materials(dict(as_of='2026-07-01T00:00:00Z', quality={}), {'a': entry('carbon', 9, 1), 'b': entry('carbon', 50, 50), 'c': entry('glass', 0, 0), 'd': entry('glass', 5, None)})
    assert result['excluded_jobs'] == 1
    carbon, glass = result['materials']
    assert carbon['material'] == 'carbon'
    assert carbon['good_quantity'] == 59
    assert carbon['scrap_quantity'] == 51
    assert carbon['scrap_rate'] == 100 * 51 / 110
    assert glass['scrap_rate'] is None


def test_conflicting_material_latest_snapshot_and_unfinished():
    job = entry('carbon', 10, 2)
    job['timeline'].append(dict(event_type='job_completed', timestamp='2026-07-02T00:00:00Z', material='glass', metadata=dict(good_quantity=12, scrap_quantity=1)))
    result = materials(dict(as_of='2026-07-02T00:00:00Z', quality={}), {'a': job, 'b': dict(timeline=[])})
    assert result['materials'][0]['material'] == 'Unknown / ambiguous'
    assert result['materials'][0]['scrap_quantity'] == 1
    assert result['multiple_completions'] == 1
