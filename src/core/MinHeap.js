/** Binary min-heap of integer ids ordered by a numeric key (the open set of the A* search). */
export default class MinHeap {
  #ids = []
  #keys = []

  get size() {
    return this.#ids.length
  }

  push(id, key) {
    const ids = this.#ids
    const keys = this.#keys
    let i = ids.length
    ids.push(id)
    keys.push(key)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= key) break
      ids[i] = ids[p]
      keys[i] = keys[p]
      i = p
    }
    ids[i] = id
    keys[i] = key
  }

  /** Removes and returns the id with the smallest key. */
  pop() {
    const ids = this.#ids
    const keys = this.#keys
    const top = ids[0]
    const lastId = ids.pop()
    const lastKey = keys.pop()
    if (ids.length) {
      let i = 0
      const n = ids.length
      for (;;) {
        let m = 2 * i + 1
        if (m >= n) break
        if (m + 1 < n && keys[m + 1] < keys[m]) m++
        if (keys[m] >= lastKey) break
        ids[i] = ids[m]
        keys[i] = keys[m]
        i = m
      }
      ids[i] = lastId
      keys[i] = lastKey
    }
    return top
  }
}
