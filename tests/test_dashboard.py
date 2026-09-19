import pytest
from backend.dashboard import analyze


def event(id, kind, day, job='a', **metadata):
    return dict(event_id=id, event_type=kind, timestamp=f'2026-07-{day:02}T00:00:00Z', job_id=job, metadata=metadata)


def run(events):
    return analyze([dict(row_number=i, data=e) for i, e in enumerate(events, 1)])


def test_as_of_blocker_evidence_duplicates_and_completion():
    created = event('1', 'job_created', 1, target_due_at='2026-07-02T00:00:00Z', target_quantity=10)
    overview, jobs = run([event('5', 'cycle_completed', 5), created, created,
                          dict(created, quantity=99), event('2', 'job_blocked', 2, reason='missing_tool'),
                          event('3', 'job_created', 1, job='b', target_due_at='2026-07-02T00:00:00Z'),
                          event('4', 'job_completed', 3, job='b')])
    assert overview['blocked_count'] == 1
    assert overview['jobs'][0]['blocked_hours'] == 72
    assert overview['jobs'][0]['blocker']['reason'] == 'missing_tool'
    assert overview['quality']['duplicates'] == 1
    assert overview['quality']['conflicts'] == 1
    assert len(jobs['a']['timeline']) == 3
    assert jobs['a']['timeline'][0]['event_id'] == '1'


def test_resolved_and_completed_excluded_but_future_and_missing_due_included():
    overview, _ = run([event('1', 'job_blocked', 1), event('2', 'job_unblocked', 2),
                      event('3', 'job_created', 1, job='b', target_due_at='2027-07-02T00:00:00Z'),
                      event('4', 'job_blocked', 2, job='b'),
                      event('5', 'job_blocked', 1, job='c'),
                      event('6', 'job_blocked', 1, job='d'),
                      event('7', 'job_completed', 3, job='d')])
    assert overview['blocked_count'] == 2
    assert [j['job_id'] for j in overview['jobs']] == ['c', 'b']
    assert overview['quality']['jobs_without_due_date'] == 1


def test_top_ten_sorted_and_invalid_records_flagged():
    events = [event(str(i), 'job_blocked', i+1, job=str(i)) for i in range(12)]
    overview, _ = run(events + [dict(event_id='invalid')])
    assert overview['blocked_count'] == 12
    assert len(overview['jobs']) == 10
    assert overview['jobs'][0]['job_id'] == '0'
    assert overview['quality']['invalid_records'] == 1


def test_repeated_blocks_preserve_start_and_reblock_resets():
    overview, _ = run([event('1', 'job_blocked', 1), event('2', 'job_blocked', 2, reason='missing_tool'), event('3', 'cycle_completed', 4)])
    assert overview['jobs'][0]['blocked_hours'] == 72
    assert overview['jobs'][0]['blocker']['reason'] == 'missing_tool'
    overview, _ = run([event('1', 'job_blocked', 1), event('2', 'job_unblocked', 2), event('3', 'job_blocked', 3), event('4', 'cycle_completed', 4)])
    assert overview['jobs'][0]['blocked_hours'] == 24


def test_non_manufacturing_dataset():
    with pytest.raises(ValueError, match='no manufacturing events'):
        run([dict(machine='M1')])
