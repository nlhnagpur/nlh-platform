import { useState, useEffect } from 'react'

// true while the viewport matches the CSS media query (e.g. '(max-width: 640px)').
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(function () {
    return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false
  })
  useEffect(function () {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(query)
    function onChange(e) { setMatches(e.matches) }
    setMatches(mq.matches)
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return function () {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [query])
  return matches
}
