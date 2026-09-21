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
// 图书 ID 序列：单独持久化，删除图书后 ID 也不复用，避免借阅记录错位到新图书
const ID_SEQ_KEY = 'library_books_id_seq'

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

// 计算初始 ID 序列：取初始数据与本地数据中的最大 ID，之后只增不减、永不复用
function loadInitialIdSeq() {
  let maxId = initialBooks.reduce((max, book) => Math.max(max, Number(book.id) || 0), 0)
  const storedSeq = Number(localStorage.getItem(ID_SEQ_KEY))
  if (!Number.isNaN(storedSeq) && storedSeq > 0) {
    maxId = Math.max(maxId, storedSeq)
  }
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      const parsedBooks = JSON.parse(stored)
      maxId = parsedBooks.reduce((max, book) => Math.max(max, Number(book.id) || 0), maxId)
    } catch (e) {
      console.error('Failed to parse stored books:', e)
    }
  }
  return maxId
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
  const idSeq = ref(loadInitialIdSeq())

  // 监听变化并保存到 localStorage
  watch(books, (newBooks) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newBooks))
  }, { deep: true })

  watch(idSeq, (newSeq) => {
    localStorage.setItem(ID_SEQ_KEY, String(newSeq))
  })

  const totalBooks = computed(() => books.value.length)
  const totalAvailable = computed(() =>
    books.value.reduce((sum, book) => sum + book.available, 0)
  )

  // 各分类在藏图书数量（按图书自身的 categoryId 实时统计，删除/新增后即时回显）
  const bookCountByCategory = computed(() => {
    const countMap = {}
    for (const book of books.value) {
      const key = book.categoryId
      if (key !== null && key !== undefined) {
        countMap[key] = (countMap[key] || 0) + 1
      }
    }
    return countMap
  })

  // 全库唯一标识核对入口：列表、详情、借阅都必须通过 book.id 核对，禁止按书名/ISBN 匹配
  function getBookById(id) {
    return books.value.find(book => book.id === id)
  }

  function addBook(book) {
    // 使用独立且持久化的自增序列，删除图书后其 ID 也不会再分配给其他图书
    const newId = idSeq.value + 1
    idSeq.value = newId
    const total = Math.max(0, Number(book.total) || 0)
    books.value.push({
      ...book,
      id: newId,
      total,
      // 新入库图书全部可借，库存以本次录入为准
      available: total
    })
    return newId
  }

  function updateBook(id, data) {
    // 严格按图书 ID 定位，避免同名图书互相串改
    const index = books.value.findIndex(book => book.id === id)
    if (index === -1) {
      return false
    }

    const current = books.value[index]
    const patch = { ...data }
    // 标识不允许通过更新修改
    delete patch.id

    // 编辑总库存时保持"已借出数量"不变，联动修正可借库存，防止 available/total 不一致
    if (patch.total !== undefined && Number(patch.total) !== Number(current.total)) {
      const newTotal = Math.max(0, Number(patch.total) || 0)
      const borrowedCount = Math.max(0, Number(current.total) - Number(current.available))
      patch.total = newTotal
      patch.available = Math.max(0, newTotal - borrowedCount)
    }

    // 可借库存始终夹在 [0, total] 区间内
    if (patch.available !== undefined) {
      const totalLimit = patch.total !== undefined ? Number(patch.total) : Number(current.total)
      patch.available = Math.min(totalLimit, Math.max(0, Number(patch.available)))
    }

    books.value[index] = { ...current, ...patch }
    return true
  }

  // 删除图书：已借出（含借阅中/已逾期）的图书拒绝删除；
  // 删除失败时原图书记录与借阅记录均保留，并通过返回值说明原因
  function deleteBook(id) {
    const book = getBookById(id)
    if (!book) {
      return { success: false, message: '图书不存在或已被删除，记录未改动' }
    }

    const borrowStore = useBorrowStore()
    const activeRecords = borrowStore.records.filter(record =>
      record.bookId === id &&
      (record.status === 'borrowed' || record.status === 'overdue')
    )
    if (activeRecords.length > 0) {
      return {
        success: false,
        message: `《${book.title}》尚有 ${activeRecords.length} 条未归还借阅记录，请先归还后再删除`
      }
    }

    const index = books.value.findIndex(item => item.id === id)
    books.value.splice(index, 1)
    return { success: true, message: '图书删除成功' }
  }

  // 分类重命名后同步图书上冗余的分类名称
  function updateBooksCategoryName(categoryId, categoryName) {
    books.value.forEach(book => {
      if (book.categoryId === categoryId && book.categoryName !== categoryName) {
        book.categoryName = categoryName
      }
    })
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
    return books.value.filter(book => book.categoryId === categoryId)
  }

  return {
    books,
    loading,
    totalBooks,
    totalAvailable,
    bookCountByCategory,
    getBookById,
    addBook,
    updateBook,
    deleteBook,
    updateBooksCategoryName,
    searchBooks,
    filterByCategory
  }
})
