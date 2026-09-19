from backend.dashboard import run_size


def test_latest_snapshot_dimensions_and_exclusions():
    def event(good, scrap, part='p1'):
        return dict(event_type='job_completed', part_id=part, material='carbon', metadata=dict(good_quantity=good, scrap_quantity=scrap, facility='la_01'))
    jobs = {'a': dict(job_id='a', timeline=[event(5, 5), event(90, 10)]), 'b': dict(job_id='b', timeline=[event(0, 0)]), 'c': dict(job_id='c', timeline=[event(None, 2)]), 'd': dict(job_id='d', timeline=[event(1, 1, 'p2'), event(8, 2)])}
    result = run_size(dict(as_of='2026-07-01', quality={}), jobs)
    assert result['excluded_jobs'] == 2
    assert result['points'][0]['quantity'] == 100
    assert result['points'][0]['rate'] == 10
    assert result['points'][0]['facility'] == 'la_01'
    assert result['points'][1]['part_id'] == 'Unknown / ambiguous'
