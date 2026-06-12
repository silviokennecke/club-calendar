import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import { createTestUser, createTestCalendarWithClub, getAuthHeader } from '../test/helpers.js'

// ─── Properties ──────────────────────────────────────────────────────────────

describe('Properties /api/calendars/:calendarId/properties', () => {
  it('returns empty list initially', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/properties`, {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('creates a property', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/properties`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Indoor', icon: '🏠' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { name: string; icon: string }
    expect(body.name).toBe('Indoor')
    expect(body.icon).toBe('🏠')
  })

  it('updates a property', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const createRes = await app.request(`/api/calendars/${calendar.id}/properties`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Outdoor' }),
    })
    const created = await createRes.json() as { id: number }
    const res = await app.request(`/api/calendars/${calendar.id}/properties/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Indoor' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { name: string }
    expect(body.name).toBe('Indoor')
  })

  it('deletes a property', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const createRes = await app.request(`/api/calendars/${calendar.id}/properties`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ToDelete' }),
    })
    const created = await createRes.json() as { id: number }
    const res = await app.request(`/api/calendars/${calendar.id}/properties/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
  })

  it('returns 403 for non-member', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const other = await createTestUser({ email: 'other-prop@example.com' })
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/properties`, {
      headers: { Authorization: await getAuthHeader(other.id) },
    })
    expect(res.status).toBe(403)
  })
})

// ─── Features ────────────────────────────────────────────────────────────────

describe('Features /api/calendars/:calendarId/features', () => {
  it('returns empty list initially', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/features`, {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('creates a feature', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/features`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Live Music' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { name: string }
    expect(body.name).toBe('Live Music')
  })

  it('updates a feature', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const createRes = await app.request(`/api/calendars/${calendar.id}/features`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Old Feature' }),
    })
    const created = await createRes.json() as { id: number }
    const res = await app.request(`/api/calendars/${calendar.id}/features/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Feature' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { name: string }
    expect(body.name).toBe('New Feature')
  })

  it('deletes a feature', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const createRes = await app.request(`/api/calendars/${calendar.id}/features`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ToDelete' }),
    })
    const created = await createRes.json() as { id: number }
    const res = await app.request(`/api/calendars/${calendar.id}/features/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
  })

  it('returns 403 for non-member', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const other = await createTestUser({ email: 'other-feat@example.com' })
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/features`, {
      headers: { Authorization: await getAuthHeader(other.id) },
    })
    expect(res.status).toBe(403)
  })
})

// ─── Target Groups ────────────────────────────────────────────────────────────

describe('Target Groups /api/calendars/:calendarId/target-groups', () => {
  it('returns empty list initially', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/target-groups`, {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('creates a target group', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/target-groups`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Seniors' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { name: string }
    expect(body.name).toBe('Seniors')
  })

  it('updates a target group', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const createRes = await app.request(`/api/calendars/${calendar.id}/target-groups`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Old Group' }),
    })
    const created = await createRes.json() as { id: number }
    const res = await app.request(`/api/calendars/${calendar.id}/target-groups/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Juniors' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { name: string }
    expect(body.name).toBe('Juniors')
  })

  it('deletes a target group', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const createRes = await app.request(`/api/calendars/${calendar.id}/target-groups`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ToDelete' }),
    })
    const created = await createRes.json() as { id: number }
    const res = await app.request(`/api/calendars/${calendar.id}/target-groups/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
  })

  it('returns 403 for non-member', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const other = await createTestUser({ email: 'other-tg@example.com' })
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/target-groups`, {
      headers: { Authorization: await getAuthHeader(other.id) },
    })
    expect(res.status).toBe(403)
  })
})

// ─── Locations ────────────────────────────────────────────────────────────────

describe('Locations /api/calendars/:calendarId/locations', () => {
  it('returns empty list initially', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/locations`, {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('creates a location', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/locations`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: 'Hauptstraße 1, 10115 Berlin' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { address: string }
    expect(body.address).toBe('Hauptstraße 1, 10115 Berlin')
  })

  it('updates a location', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const createRes = await app.request(`/api/calendars/${calendar.id}/locations`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: 'Old Street 1' }),
    })
    const created = await createRes.json() as { id: number }
    const res = await app.request(`/api/calendars/${calendar.id}/locations/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: 'New Street 2' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { address: string }
    expect(body.address).toBe('New Street 2')
  })

  it('deletes a location', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const createRes = await app.request(`/api/calendars/${calendar.id}/locations`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: 'ToDelete Street' }),
    })
    const created = await createRes.json() as { id: number }
    const res = await app.request(`/api/calendars/${calendar.id}/locations/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
  })

  it('returns 403 for non-member', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const other = await createTestUser({ email: 'other-loc@example.com' })
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/locations`, {
      headers: { Authorization: await getAuthHeader(other.id) },
    })
    expect(res.status).toBe(403)
  })
})

// ─── Event Templates ──────────────────────────────────────────────────────────

describe('Event Templates /api/calendars/:calendarId/templates', () => {
  it('returns empty list initially', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/templates`, {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('creates a template', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/templates`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Weekly Training',
        timezone: 'Europe/Berlin',
        timeBegin: '18:00',
        timeEnd: '20:00',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { name: string; timeBegin: string; timeEnd: string }
    expect(body.name).toBe('Weekly Training')
    expect(body.timeBegin).toBe('18:00')
    expect(body.timeEnd).toBe('20:00')
  })

  it('gets a single template', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const createRes = await app.request(`/api/calendars/${calendar.id}/templates`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Single Template',
        timezone: 'Europe/Berlin',
        timeBegin: '10:00',
        timeEnd: '12:00',
      }),
    })
    const created = await createRes.json() as { id: number }
    const res = await app.request(`/api/calendars/${calendar.id}/templates/${created.id}`, {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { id: number; name: string }
    expect(body.id).toBe(created.id)
    expect(body.name).toBe('Single Template')
  })

  it('updates a template', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const createRes = await app.request(`/api/calendars/${calendar.id}/templates`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Old Template',
        timezone: 'Europe/Berlin',
        timeBegin: '08:00',
        timeEnd: '09:00',
      }),
    })
    const created = await createRes.json() as { id: number }
    const res = await app.request(`/api/calendars/${calendar.id}/templates/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Template Name' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { name: string }
    expect(body.name).toBe('New Template Name')
  })

  it('creates a template with related ids and includes them in response', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    // Create a property and feature first
    const propRes = await app.request(`/api/calendars/${calendar.id}/properties`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Indoor' }),
    })
    const prop = await propRes.json() as { id: number }
    const res = await app.request(`/api/calendars/${calendar.id}/templates`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Template With Props',
        timezone: 'Europe/Berlin',
        timeBegin: '14:00',
        timeEnd: '16:00',
        propertyIds: [prop.id],
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { properties: { propertyId: number }[] }
    expect(body.properties.some((p) => p.propertyId === prop.id)).toBe(true)
  })

  it('deletes a template', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const createRes = await app.request(`/api/calendars/${calendar.id}/templates`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'ToDelete',
        timezone: 'Europe/Berlin',
        timeBegin: '07:00',
        timeEnd: '08:00',
      }),
    })
    const created = await createRes.json() as { id: number }
    const res = await app.request(`/api/calendars/${calendar.id}/templates/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
  })

  it('returns 403 for non-member', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const other = await createTestUser({ email: 'other-tmpl@example.com' })
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/templates`, {
      headers: { Authorization: await getAuthHeader(other.id) },
    })
    expect(res.status).toBe(403)
  })
})
