import React from 'react'
import { defaultEnd, batchHours, hoursLabel, timeRange } from '../utils/batchTime'

// Start time and end time of a batch's session. The end follows the start (one hour later) until it is set by hand.
//   time / endTime: 'HH:MM' strings ('' = not set)      onChange({ time }) or onChange({ end_time })
export default function BatchTimeFields({ time, endTime, onChange }) {
  const end = endTime || defaultEnd(time)
  const bad = !!time && !!endTime && batchHours(time, endTime) === 1 && endTime <= time
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>Start
          <input type="time" value={time || ''} onChange={function (e) { onChange({ time: e.target.value }) }} style={{ display: 'block', marginTop: 2 }} />
        </label>
        <label style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>End
          <input type="time" value={end || ''} onChange={function (e) { onChange({ end_time: e.target.value }) }} style={{ display: 'block', marginTop: 2 }} />
        </label>
        {endTime && (
          <button type="button" className="btn-s" style={{ fontSize: 10, alignSelf: 'flex-end' }} onClick={function () { onChange({ end_time: '' }) }}>Back to 1 hr</button>
        )}
      </div>
      {time && (
        <div style={{ fontSize: 11, color: bad ? 'var(--red)' : 'var(--text3)', marginTop: 4 }}>
          {bad ? 'The end time must be after the start time.' : 'Session: ' + timeRange(time, endTime) + ' (' + hoursLabel(batchHours(time, endTime)) + ')'}
        </div>
      )}
    </div>
  )
}
