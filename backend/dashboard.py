"""Derive historical job status without modifying imported evidence."""
from datetime import datetime, timezone


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except ValueError:
        return None


def analyze(records):
    seen, events = {}, []
    quality = dict(duplicates=0, conflicts=0, invalid_records=0, jobs_without_due_date=0)
    for record in records:
        event = record['data']
        if not all(isinstance(event.get(k), str) and event[k] for k in ('event_id', 'job_id', 'event_type')) or not timestamp(event.get('timestamp')):
            quality['invalid_records'] += 1
            continue
        identifier = event['event_id']
        if identifier in seen:
            quality['duplicates' if seen[identifier] == event else 'conflicts'] += 1
            continue
        seen[identifier] = event
        events.append((timestamp(event['timestamp']), record['row_number'], event))
    if not events:
        raise ValueError('This dataset has no manufacturing events with event_id, job_id, event_type and a timezone-aware timestamp.')
    events.sort(key=lambda entry: (entry[0], entry[1]))
    as_of = events[-1][0]
    jobs = {}
    for time, line, event in events:
        job = jobs.setdefault(event['job_id'], dict(job_id=event['job_id'], customer_id=None, due_at=None, target_quantity=None, blocker=None, completed=False, timeline=[]))
        metadata = event.get('metadata')
        metadata = metadata if isinstance(metadata, dict) else {}
        if event['event_type'] == 'job_created' and not job.get('created'):
            job.update(created=True, customer_id=event.get('customer_id'), due_at=metadata.get('target_due_at'), target_quantity=metadata.get('target_quantity', event.get('quantity')))
        if event['event_type'] == 'job_blocked':
            job['blocker'] = dict(reason=metadata.get('reason') or 'Unspecified blocker', since=job['blocker']['since'] if job['blocker'] else event['timestamp'])
        elif event['event_type'] == 'job_unblocked':
            job['blocker'] = None
        elif event['event_type'] == 'job_completed':
            job['completed'] = True
            job['blocker'] = None
        job['last_activity'] = event['timestamp']
        job['timeline'].append(dict(row_number=line, **event))
    blocked = []
    for job in jobs.values():
        if not job['completed'] and job['blocker']:
            if timestamp(job['due_at']) is None:
                quality['jobs_without_due_date'] += 1
                job['due_at'] = None
            job['blocked_hours'] = (as_of - timestamp(job['blocker']['since'])).total_seconds() / 3600
            blocked.append({k: v for k, v in job.items() if k not in ('timeline', 'created')})
    blocked.sort(key=lambda job: (-job['blocked_hours'], job['job_id']))
    return dict(as_of=as_of.isoformat(), blocked_count=len(blocked), jobs=blocked[:10], quality=quality), jobs


def tooling(overview, jobs, scope='unresolved'):
    """Missing-tool intervals; tool association is conservative and job-wide."""
    groups = {}
    as_of = timestamp(overview['as_of'])
    for job in jobs.values():
        tools = set()
        intervals = []
        active = None
        for event in job['timeline']:
            metadata = event.get('metadata')
            metadata = metadata if isinstance(metadata, dict) else {}
            tool = metadata.get('tool_id')
            if isinstance(tool, str) and tool:
                tools.add(tool)
            kind, time = event['event_type'], timestamp(event['timestamp'])
            if kind == 'job_blocked':
                if active and metadata.get('reason') != 'missing_tool':
                    intervals.append((active, time, 'Reason changed'))
                    active = None
                if metadata.get('reason') == 'missing_tool' and active is None:
                    active = time
            elif kind in ('job_unblocked', 'job_completed') and active:
                intervals.append((active, time, 'Unblocked' if kind == 'job_unblocked' else 'Completed'))
                active = None
        if active:
            intervals.append((active, as_of, 'Unresolved'))
        tool_id = next(iter(tools)) if len(tools) == 1 else 'Unknown / ambiguous'
        for start, end, status in intervals:
            if scope == 'unresolved' and status != 'Unresolved':
                continue
            group = groups.setdefault(tool_id, dict(tool_id=tool_id, job_hours=0, intervals=[]))
            hours = (end - start).total_seconds() / 3600
            group['job_hours'] += hours
            group['intervals'].append(dict(job_id=job['job_id'], customer_id=job['customer_id'], start=start.isoformat(), end=end.isoformat(), status=status, hours=hours))
    result = sorted(groups.values(), key=lambda group: (-group['job_hours'], group['tool_id']))
    for group in result:
        group['job_count'] = len({interval['job_id'] for interval in group['intervals']})
        group['intervals'].sort(key=lambda interval: (-interval['hours'], interval['job_id']))
    return dict(as_of=overview['as_of'], scope=scope, tools=result, quality=overview['quality'])


def good_output(overview, jobs):
    groups = {}
    excluded = 0
    multiple_completions = 0
    def quantity(value):
        return isinstance(value, int) and not isinstance(value, bool) and value >= 0
    for job in jobs.values():
        completions = [e for e in job['timeline'] if e['event_type'] == 'job_completed']
        if not completions:
            continue
        multiple_completions += len(completions) > 1
        # Completion events are snapshots, never additive. Use the latest.
        completion = completions[-1]
        metadata = completion.get('metadata')
        metadata = metadata if isinstance(metadata, dict) else {}
        target, good = job['target_quantity'], metadata.get('good_quantity')
        if not quantity(target) or not quantity(good):
            excluded += 1
            continue
        scrap = metadata.get('scrap_quantity')
        customer = job['customer_id'] or 'Unknown customer'
        group = groups.setdefault(customer, dict(customer_id=customer, target_quantity=0, good_quantity=0, shortfall=0, completed_jobs=0, jobs=[]))
        shortfall = max(target - good, 0)
        group['target_quantity'] += target
        group['good_quantity'] += good
        group['shortfall'] += shortfall
        group['completed_jobs'] += 1
        if shortfall:
            group['jobs'].append(dict(job_id=job['job_id'], target_quantity=target, good_quantity=good, scrap_quantity=scrap if quantity(scrap) else None, shortfall=shortfall, completed_at=completion['timestamp']))
    customers = sorted(groups.values(), key=lambda g: (-g['shortfall'], g['customer_id']))
    for group in customers:
        group['affected_jobs'] = len(group['jobs'])
        group['shortfall_percent'] = group['shortfall'] / group['target_quantity'] * 100 if group['target_quantity'] else None
        group['jobs'].sort(key=lambda j: (-j['shortfall'], j['job_id']))
    target = sum(g['target_quantity'] for g in customers)
    shortfall = sum(g['shortfall'] for g in customers)
    return dict(as_of=overview['as_of'], customers=customers, shortfall=shortfall,
                shortfall_percent=shortfall / target * 100 if target else None,
                affected_jobs=sum(g['affected_jobs'] for g in customers),
                completed_jobs=sum(g['completed_jobs'] for g in customers),
                excluded_jobs=excluded, multiple_completions=multiple_completions, quality=overview['quality'])


def tool_scrap(overview, jobs):
    groups = {}
    excluded = multiple = 0
    for job in jobs.values():
        completions = [e for e in job['timeline'] if e['event_type'] == 'job_completed']
        if not completions:
            continue
        multiple += len(completions) > 1
        completion = completions[-1]
        meta = completion.get('metadata')
        meta = meta if isinstance(meta, dict) else {}
        good, scrap = meta.get('good_quantity'), meta.get('scrap_quantity')
        if not all(isinstance(q, int) and not isinstance(q, bool) and q >= 0 for q in (good, scrap)):
            excluded += 1
            continue
        tools = {e['metadata']['tool_id'] for e in job['timeline'] if isinstance(e.get('metadata'), dict) and isinstance(e['metadata'].get('tool_id'), str) and e['metadata']['tool_id']}
        tool_id = next(iter(tools)) if len(tools) == 1 else 'Unknown / ambiguous'
        group = groups.setdefault(tool_id, dict(tool_id=tool_id, good_quantity=0, scrap_quantity=0, jobs=[]))
        group['good_quantity'] += good
        group['scrap_quantity'] += scrap
        group['jobs'].append(dict(job_id=job['job_id'], customer_id=job['customer_id'], good_quantity=good, scrap_quantity=scrap, scrap_rate=100 * scrap / (good + scrap) if good + scrap else None, completed_at=completion['timestamp']))
    for group in groups.values():
        total = group['good_quantity'] + group['scrap_quantity']
        group['scrap_rate'] = 100 * group['scrap_quantity'] / total if total else None
        group['jobs'].sort(key=lambda j: (-j['scrap_quantity'], j['job_id']))
    return dict(as_of=overview['as_of'], tools=sorted(groups.values(), key=lambda g: (-g['scrap_quantity'], g['tool_id'])), excluded_jobs=excluded, multiple_completions=multiple, quality=overview['quality'])


def _output_by_field(overview, jobs, field, collection):
    groups = {}
    excluded = 0
    multiple = 0
    for job in jobs.values():
        completions = [e for e in job['timeline'] if e['event_type'] == 'job_completed']
        if not completions:
            continue
        multiple += len(completions) > 1
        completion = completions[-1]
        meta = completion.get('metadata')
        meta = meta if isinstance(meta, dict) else {}
        good, scrap = meta.get('good_quantity'), meta.get('scrap_quantity')
        if not all(isinstance(q, int) and not isinstance(q, bool) and q >= 0 for q in (good, scrap)):
            excluded += 1
            continue
        names = {e[field] for e in job['timeline'] if isinstance(e.get(field), str) and e[field]}
        material = next(iter(names)) if len(names) == 1 else 'Unknown / ambiguous'
        group = groups.setdefault(material, {field: material, 'good_quantity': 0, 'scrap_quantity': 0, 'jobs': []})
        group['good_quantity'] += good
        group['scrap_quantity'] += scrap
        group['jobs'].append(dict(job_id=job['job_id'], customer_id=job['customer_id'], good_quantity=good, scrap_quantity=scrap, scrap_rate=100 * scrap / (good + scrap) if good + scrap else None, completed_at=completion['timestamp']))
    for group in groups.values():
        total = group['good_quantity'] + group['scrap_quantity']
        group['scrap_rate'] = 100 * group['scrap_quantity'] / total if total else None
        group['jobs'].sort(key=lambda j: (-j['scrap_quantity'], j['job_id']))
    return dict(as_of=overview['as_of'], **{collection: sorted(groups.values(), key=lambda g: (-g['scrap_quantity'], g[field]))}, excluded_jobs=excluded, multiple_completions=multiple, quality=overview['quality'])


def materials(overview, jobs):
    return _output_by_field(overview, jobs, 'material', 'materials')


def parts(overview, jobs):
    return _output_by_field(overview, jobs, 'part_id', 'parts')


def run_size(overview, jobs):
    points = []
    excluded = 0
    for job in jobs.values():
        completions = [e for e in job['timeline'] if e['event_type'] == 'job_completed']
        if not completions:
            continue
        event = completions[-1]
        meta = event.get('metadata') or {}
        if not isinstance(meta, dict):
            meta = {}
        good, scrap = meta.get('good_quantity'), meta.get('scrap_quantity')
        if not all(isinstance(q, int) and not isinstance(q, bool) and q >= 0 for q in (good, scrap)) or good + scrap == 0:
            excluded += 1
            continue
        dimensions = {}
        for field in ('part_id', 'material', 'facility'):
            values = set()
            for e in job['timeline']:
                source = e.get('metadata') if field == 'facility' else e
                value = source.get(field) if isinstance(source, dict) else None
                if isinstance(value, str) and value:
                    values.add(value)
            dimensions[field] = next(iter(values)) if len(values) == 1 else 'Unknown / ambiguous'
        points.append(dict(job_id=job['job_id'], quantity=good + scrap, scrap=scrap, rate=100 * scrap / (good + scrap), **dimensions))
    return dict(as_of=overview['as_of'], points=points, excluded_jobs=excluded, quality=overview['quality'])
