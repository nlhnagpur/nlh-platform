import React from 'react'

// Title + optional subtitle/count on the left, actions on the right.
export default function PageHeader({ title, subtitle, count, actions }) {
  return (
    <div className="ui-ph">
      <div className="ui-ph-main">
        <div className="ui-ph-title">
          {title}
          {count !== undefined && count !== null && <span className="ui-ph-count">{count}</span>}
        </div>
        {subtitle && <div className="ui-ph-sub">{subtitle}</div>}
      </div>
      {actions && <div className="ui-ph-actions">{actions}</div>}
    </div>
  )
}
