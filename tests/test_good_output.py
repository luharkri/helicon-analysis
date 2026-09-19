from backend.dashboard import good_output


def job(target, good, customer='c', scrap=2):
    return dict(job_id=str(target), target_quantity=target, customer_id=customer, timeline=[dict(event_type='job_completed', timestamp='2026-07-02T00:00:00Z', metadata=dict(good_quantity=good, scrap_quantity=scrap))])


def calculate(jobs):
    return good_output(dict(as_of='2026-07-03T00:00:00Z', quality={}), jobs)


def test_shortfall_does_not_net_excess_and_percentage_includes_all_targets():
    result = calculate({'a': job(10, 7), 'b': job(20, 30)})
    assert result['shortfall'] == 3
    assert result['shortfall_percent'] == 10
    assert result['affected_jobs'] == 1
    assert result['completed_jobs'] == 2
    assert len(result['customers'][0]['jobs']) == 1


def test_invalid_quantities_excluded_missing_scrap_and_zero_target():
    result = calculate({'a': job(None, 3), 'b': job(10, None), 'c': job(0, 0), 'd': job(10, 8, customer=None, scrap=None), 'e': job(True, 0)})
    assert result['excluded_jobs'] == 3
    assert result['customers'][0]['customer_id'] == 'Unknown customer'
    assert result['customers'][0]['jobs'][0]['scrap_quantity'] is None
    assert result['customers'][1]['shortfall_percent'] is None


def test_latest_completion_snapshot_and_unfinished_exclusion():
    completed = job(10, 3)
    completed['timeline'].append(dict(event_type='job_completed', timestamp='2026-07-03T00:00:00Z', metadata=dict(good_quantity=9)))
    result = calculate({'a': completed, 'b': dict(timeline=[])})
    assert result['shortfall'] == 1
    assert result['multiple_completions'] == 1
    assert result['completed_jobs'] == 1
    assert calculate({})['shortfall_percent'] is None
