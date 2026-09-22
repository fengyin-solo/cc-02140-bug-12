import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { books as initialBooks } from '@/data/mockData'
import { useBorrowStore } from '@/stores/borrow'

// 导入本地封面图片
import hlmCover from '@/views/img/hlm.webp'
import jsCover from '@/views/img/js.webp'
import sgyyCover from '@/views/img/sgyy.webp'
import vueCover from '@/views/img/vue.jpeg'
import sjCover from '@/views/img/sj.webp'
import jjxCover from '@/views/img/jjx.webp'
import xlxCover from '@/views/img/xlx.webp'
import sxCover from '@/views/img/sx.webp'

const STORAGE_KEY = 'library_books'

// 默认书籍封面图片（使用本地图片）
const DEFAULT_COVERS = [
  hlmCover,
  jsCover,
  sgyyCover,
  vueCover,
  sjCover,
  jjxCover,
  xlxCover,
  sxCover
]

// 获取默认封面
function getDefaultCover(index) {
  return DEFAULT_COVERS[index % DEFAULT_COVERS.length]
}

// 检查并修复书籍封面
function fixBookCovers(books) {
  return books.map((book, index) => {
    // 如果封面是 SVG data URI、placeholder 或外部链接，则使用本地封面
    if (!book.cover || book.cover.includes('data:image/svg') || book.cover.includes('placeholder.com') || book.cover.startsWith('http')) {
      return {
        ...book,
        cover: getDefaultCover(index)
      }
    }
    return book
  })
}

// 统一的图书标识核对：列表、详情、借阅入口都必须通过图书 id 找书，
// 绝不允许按书名匹配（同名图书会错位）。id 统一转数字，兼容字符串来源。
function isSameBookId(bookId, targetId) {
  return Number(bookId) === Number(targetId)
}

export const useBookStore = defineStore('book', () => {
  // 从 localStorage 读取或使用初始数据
  const loadBooks = () => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const parsedBooks = JSON.parse(stored)
        // 修复旧数据中的图片链接
        return fixBookCovers(parsedBooks)
      } catch (e) {
        console.error('Failed to parse stored books:', e)
      }
    }
    return [...initialBooks]
  }

  const books = ref(loadBooks())
  const loading = ref(false)

  // 监听变化并保存到 localStorage
  watch(books, (newBooks) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newBooks))
  }, { deep: true })

  const totalBooks = computed(() => books.value.length)
  const totalAvailable = computed(() =>
    books.value.reduce((sum, book) => sum + book.available, 0)
  )

  // 各分类的真实在册图书数量（统计回显一律以此为准，不再使用静态 bookCount）
  const categoryBookCounts = computed(() => {
    const counts = {}
    books.value.forEach(book => {
      counts[book.categoryId] = (counts[book.categoryId] || 0) + 1
    })
    return counts
  })

  function countBooksByCategory(categoryId) {
    return books.value.filter(book => isSameBookId(book.categoryId, categoryId)).length
  }

  // 按图书 id 获取图书——全系统唯一的图书核对入口
  function getBookById(id) {
    if (id === null || id === undefined || id === '') return undefined
    return books.value.find(book => isSameBookId(book.id, id))
  }

  // 某本书当前未归还（借阅中 / 已逾期）的数量
  function getBorrowedCount(id) {
    const book = getBookById(id)
    if (!book) return 0
    const borrowStore = useBorrowStore()
    return borrowStore.records.reduce((count, record) => {
      if (!isSameBookId(record.bookId, book.id)) return count
      return count + (record.status === 'borrowed' || record.status === 'overdue' ? 1 : 0)
    }, 0)
  }

  // 生成新 id：连同历史借阅记录里出现过的 bookId 一起取最大值，
  // 避免删除后 id 被复用，导致旧借阅记录错挂到新书上
  function nextBookId() {
    const borrowStore = useBorrowStore()
    const allIds = [
      ...books.value.map(book => Number(book.id)),
      ...borrowStore.records.map(record => Number(record.bookId)).filter(Boolean)
    ]
    return allIds.length > 0 ? Math.max(...allIds) + 1 : 1
  }

  function addBook(book) {
    const newId = nextBookId()
    books.value.push({ ...book, id: newId })
    return newId
  }

  // 按图书 id 更新元数据；找不到目标图书时返回 false（不会误改同名书）
  function updateBook(id, data) {
    const index = books.value.findIndex(book => isSameBookId(book.id, id))
    if (index !== -1) {
      books.value[index] = { ...books.value[index], ...data }
      return true
    }
    return false
  }

  // 修改总库存（编辑库存专用）。可借数 = 总库存 - 未归还数量，
  // 保证 0 <= available <= total，且未还图书不会因改库存而“消失”
  function updateBookTotal(id, total) {
    const book = getBookById(id)
    if (!book) {
      return { success: false, reason: '图书不存在或已被删除，库存未修改' }
    }
    const newTotal = Number(total)
    if (!Number.isInteger(newTotal) || newTotal < 0) {
      return { success: false, reason: '总库存必须是不小于 0 的整数' }
    }
    const borrowed = getBorrowedCount(book.id)
    if (newTotal < borrowed) {
      return { success: false, reason: `该图书尚有 ${borrowed} 本未归还，总库存不能小于未归还数量` }
    }
    const index = books.value.findIndex(item => isSameBookId(item.id, book.id))
    books.value[index] = {
      ...books.value[index],
      total: newTotal,
      available: newTotal - borrowed
    }
    return { success: true }
  }

  // 借出 / 归还引起的库存增减，严格按图书 id 核对并维护库存上下限
  function adjustBookStock(id, delta) {
    const book = getBookById(id)
    if (!book) {
      return { success: false, reason: '图书不存在或已被删除，库存未修改' }
    }
    const nextAvailable = book.available + delta
    if (nextAvailable < 0) {
      return { success: false, reason: '该图书可借库存不足' }
    }
    if (nextAvailable > book.total) {
      return { success: false, reason: '可借数量不能超过总库存' }
    }
    const index = books.value.findIndex(item => isSameBookId(item.id, book.id))
    books.value[index] = { ...books.value[index], available: nextAvailable }
    return { success: true }
  }

  // 删除图书：有未归还借阅时拒绝删除并保留原记录、说明原因；
  // 历史已归还记录保留快照，不阻止删除
  function deleteBook(id) {
    const book = getBookById(id)
    if (!book) {
      return { success: false, reason: '图书不存在或已被删除，原记录已保留' }
    }
    const borrowed = getBorrowedCount(book.id)
    if (borrowed > 0) {
      return { success: false, reason: `该图书尚有 ${borrowed} 本未归还，请先归还后再删除` }
    }
    const index = books.value.findIndex(item => isSameBookId(item.id, book.id))
    books.value.splice(index, 1)
    return { success: true }
  }

  function searchBooks(keyword) {
    if (!keyword) return books.value
    const lowerKeyword = keyword.toLowerCase()
    return books.value.filter(book =>
      book.title.toLowerCase().includes(lowerKeyword) ||
      book.author.toLowerCase().includes(lowerKeyword) ||
      book.isbn.includes(keyword)
    )
  }

  function filterByCategory(categoryId) {
    if (!categoryId) return books.value
    return books.value.filter(book => isSameBookId(book.categoryId, categoryId))
  }

  return {
    books,
    loading,
    totalBooks,
    totalAvailable,
    categoryBookCounts,
    countBooksByCategory,
    getBookById,
    getBorrowedCount,
    addBook,
    updateBook,
    updateBookTotal,
    adjustBookStock,
    deleteBook,
    searchBooks,
    filterByCategory
  }
})
