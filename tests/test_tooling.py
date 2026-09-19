from backend.dashboard import analyze, tooling


def calculate(events, scope='all'):
    records = [dict(row_number=i, data=dict(event_id=str(i), job_id='a', timestamp=f'2026-07-{day:02}T00:00:00Z', event_type=kind, metadata=meta)) for i, (day, kind, meta) in enumerate(events)]
    overview, jobs = analyze(records)
    return tooling(overview, jobs, scope)


def test_intervals_repeats_resolution_and_scopes():
    events = [(1, 'job_blocked', dict(reason='missing_tool', tool_id='tool_1')), (2, 'job_blocked', dict(reason='missing_tool')), (3, 'job_unblocked', {}), (4, 'job_blocked', dict(reason='missing_tool')), (5, 'cycle_completed', {})]
    result = calculate(events)
    assert result['tools'][0]['job_hours'] == 72
    assert result['tools'][0]['job_count'] == 1
    assert calculate(events, 'unresolved')['tools'][0]['job_hours'] == 24


def test_ambiguous_tool_and_reason_change():
    result = calculate([(1, 'job_blocked', dict(reason='missing_tool', tool_id='t1')), (2, 'job_blocked', dict(reason='engineering_hold', tool_id='t2')), (4, 'job_completed', {})])
    assert result['tools'][0]['tool_id'] == 'Unknown / ambiguous'
    assert result['tools'][0]['job_hours'] == 24
    assert result['tools'][0]['intervals'][0]['status'] == 'Reason changed'


def test_completion_resolves_and_other_blockers_do_not_count():
    events = [(1, 'job_blocked', dict(reason='missing_tool')), (2, 'job_completed', {})]
    assert calculate(events, 'unresolved')['tools'] == []
    assert calculate(events)['tools'][0]['job_hours'] == 24
    assert calculate([(1, 'job_blocked', dict(reason='machine_fault'))])['tools'] == []
