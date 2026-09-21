import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { borrowRecords as initialRecords } from '@/data/mockData'

const STORAGE_KEY = 'library_borrow_records'
// 借阅记录 ID 序列：单独持久化，删除记录后 ID 不复用
const ID_SEQ_KEY = 'library_borrow_records_id_seq'

function loadInitialIdSeq() {
  let maxId = initialRecords.reduce((max, record) => Math.max(max, Number(record.id) || 0), 0)
  const storedSeq = Number(localStorage.getItem(ID_SEQ_KEY))
  if (!Number.isNaN(storedSeq) && storedSeq > 0) {
    maxId = Math.max(maxId, storedSeq)
  }
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      const parsedRecords = JSON.parse(stored)
      maxId = parsedRecords.reduce((max, record) => Math.max(max, Number(record.id) || 0), maxId)
    } catch (e) {
      console.error('Failed to parse stored records:', e)
    }
  }
  return maxId
}

export const useBorrowStore = defineStore('borrow', () => {
  const loadRecords = () => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        return JSON.parse(stored)
      } catch (e) {
        console.error('Failed to parse stored records:', e)
      }
    }
    return [...initialRecords]
  }

  const records = ref(loadRecords())
  const loading = ref(false)
  const idSeq = ref(loadInitialIdSeq())

  watch(records, (newRecords) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newRecords))
  }, { deep: true })

  watch(idSeq, (newSeq) => {
    localStorage.setItem(ID_SEQ_KEY, String(newSeq))
  })

  const totalBorrowed = computed(() =>
    records.value.filter(r => r.status === 'borrowed').length
  )

  const totalOverdue = computed(() =>
    records.value.filter(r => r.status === 'overdue').length
  )

  const todayBorrows = computed(() => {
    const today = new Date().toISOString().split('T')[0]
    return records.value.filter(r => r.borrowDate === today).length
  })

  function getRecordById(id) {
    return records.value.find(record => record.id === id)
  }

  function getRecordsByReader(readerId) {
    return records.value.filter(record => record.readerId === readerId)
  }

  // 某本图书未归还（借阅中/已逾期）的记录数，供删除图书等场景做关联检查
  function getActiveBorrowCountByBook(bookId) {
    return records.value.filter(record =>
      record.bookId === bookId &&
      (record.status === 'borrowed' || record.status === 'overdue')
    ).length
  }

  function addRecord(record) {
    const newId = idSeq.value + 1
    idSeq.value = newId
    const today = new Date().toISOString().split('T')[0]
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 30)

    records.value.push({
      ...record,
      id: newId,
      borrowDate: today,
      dueDate: dueDate.toISOString().split('T')[0],
      returnDate: null,
      status: 'borrowed',
      renewCount: 0
    })
    return newId
  }

  function returnBook(id) {
    const index = records.value.findIndex(record => record.id === id)
    if (index !== -1) {
      records.value[index].returnDate = new Date().toISOString().split('T')[0]
      records.value[index].status = 'returned'
      return true
    }
    return false
  }

  function renewBook(id) {
    const index = records.value.findIndex(record => record.id === id)
    if (index !== -1 && records.value[index].renewCount < 2) {
      const newDueDate = new Date(records.value[index].dueDate)
      newDueDate.setDate(newDueDate.getDate() + 15)
      records.value[index].dueDate = newDueDate.toISOString().split('T')[0]
      records.value[index].renewCount += 1
      return true
    }
    return false
  }

  function searchRecords(keyword) {
    if (!keyword) return records.value
    const lowerKeyword = keyword.toLowerCase()
    return records.value.filter(record =>
      record.readerName.toLowerCase().includes(lowerKeyword) ||
      record.bookTitle.toLowerCase().includes(lowerKeyword) ||
      record.cardNo.toLowerCase().includes(keyword)
    )
  }

  return {
    records,
    loading,
    totalBorrowed,
    totalOverdue,
    todayBorrows,
    getRecordById,
    getRecordsByReader,
    getActiveBorrowCountByBook,
    addRecord,
    returnBook,
    renewBook,
    searchRecords
  }
})
