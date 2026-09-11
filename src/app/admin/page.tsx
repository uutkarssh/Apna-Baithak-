'use client'

import { AdminAuthProvider, useAdminAuth } from '@/components/admin/admin-auth'
import { AdminLogin } from '@/components/admin/admin-login'
import { AdminDashboard } from '@/components/admin/admin-dashboard'
import { Loader2 } from 'lucide-react'

function AdminGate() {
  const { authed, loading } = useAdminAuth()
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
      </div>
    )
  }
  if (!authed) return <AdminLogin />
  return <AdminDashboard />
}

export default function AdminPage() {
  return (
    <AdminAuthProvider>
      <AdminGate />
    </AdminAuthProvider>
  )
}
