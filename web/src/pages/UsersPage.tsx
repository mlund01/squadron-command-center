import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleUserRound, Copy, Plus, ShieldCheck } from 'lucide-react';
import { createAdminUser, listAdminUsers, updateAdminUser } from '@/api/client';
import type { AdminUser, CommandCenterRole, UserStatus } from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function UsersPage() {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ['admin-users'], queryFn: listAdminUsers });
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [invitation, setInvitation] = useState('');
  return <div>
    <PageHeader eyebrow="Command Center" title="Users" description="Manage human identities. Workspace roles and mission permissions are assigned from Access." actions={<Button onClick={() => setAdding(true)} size="sm"><Plus />Add user</Button>} />
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="grid grid-cols-[minmax(0,1fr)_8rem_7rem] gap-3 border-b bg-muted/30 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground"><span>User</span><span>CC role</span><span>Status</span></div>
      {users.data?.map((user) => <button className="grid w-full grid-cols-[minmax(0,1fr)_8rem_7rem] items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-accent/40" key={user.id} onClick={() => setSelected(user)} type="button">
        <span className="flex min-w-0 items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full border"><CircleUserRound className="size-4" /></span><span className="min-w-0"><span className="block truncate text-xs font-medium">{user.name}</span><span className="block truncate text-[11px] text-muted-foreground">{user.email}</span></span></span>
        <span className="flex items-center gap-1.5 text-xs capitalize">{user.role === 'admin' && <ShieldCheck className="size-3.5" />}{user.role}</span><Status value={user.status} />
      </button>)}
      {users.isLoading && <State text="Loading users…" />}{users.isError && <State text="Unable to load users." />}
    </div>
    <AddUserDialog open={adding} onOpenChange={setAdding} onSaved={(token) => { setInvitation(`${window.location.origin}/invite?token=${encodeURIComponent(token)}`); queryClient.invalidateQueries({ queryKey: ['admin-users'] }); }} />
    <EditUserDialog user={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} onSaved={() => { setSelected(null); queryClient.invalidateQueries({ queryKey: ['admin-users'] }); }} />
    <InvitationDialog invitation={invitation} onClose={() => setInvitation('')} />
  </div>;
}

function AddUserDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: (token:string) => void }) {
  const [name,setName]=useState(''); const [email,setEmail]=useState(''); const [role,setRole]=useState<CommandCenterRole>('member');
  const create=useMutation({mutationFn:()=>createAdminUser({name,email,role}),onSuccess:(value)=>{setName('');setEmail('');setRole('member');onOpenChange(false);onSaved(value.invitationToken);}});
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Add user</DialogTitle><DialogDescription>Create an invited Command Center identity. Authentication binds when the user signs in.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={(event)=>{event.preventDefault();create.mutate();}}><Field label="Name"><Input autoFocus value={name} onChange={(e)=>setName(e.target.value)} /></Field><Field label="Email"><Input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} /></Field><Field label="Command Center role"><RoleSelect value={role} onChange={(value)=>setRole(value as CommandCenterRole)} options={['member','admin']} /></Field>{create.isError&&<ErrorText error={create.error}/>}<Button className="w-full" disabled={!name.trim()||!email.trim()||create.isPending}>{create.isPending?'Adding…':'Add user'}</Button></form></DialogContent></Dialog>;
}

function InvitationDialog({invitation,onClose}:{invitation:string;onClose:()=>void}){return <Dialog open={Boolean(invitation)} onOpenChange={(open)=>{if(!open)onClose()}}><DialogContent><DialogHeader><DialogTitle>Share the invitation</DialogTitle><DialogDescription>This link expires in seven days and can be used once to create a built-in password. An invited OIDC user may instead sign in with the same verified email.</DialogDescription></DialogHeader><div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3"><code className="min-w-0 flex-1 break-all text-xs">{invitation}</code><Button aria-label="Copy invitation" onClick={()=>navigator.clipboard.writeText(invitation)} size="icon-sm" variant="ghost"><Copy/></Button></div><Button onClick={onClose}>Done</Button></DialogContent></Dialog>}

function EditUserDialog({ user, onOpenChange, onSaved }: { user: AdminUser | null; onOpenChange: (open:boolean)=>void; onSaved:()=>void }) {
  const [draft,setDraft]=useState<AdminUser|null>(null); const value=draft?.id===user?.id?draft:user;
  const update=useMutation({mutationFn:()=>updateAdminUser(user!.id,{name:value!.name,role:value!.role,status:value!.status}),onSuccess:onSaved});
  return <Dialog open={Boolean(user)} onOpenChange={onOpenChange}><DialogContent>{value&&<><DialogHeader><DialogTitle>{value.name}</DialogTitle><DialogDescription>{value.email}</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Name"><Input value={value.name} onChange={(e)=>setDraft({...value,name:e.target.value})}/></Field><Field label="Command Center role"><RoleSelect value={value.role} onChange={(role)=>setDraft({...value,role:role as CommandCenterRole})} options={['member','admin']}/></Field><Field label="Status"><RoleSelect value={value.status} onChange={(status)=>setDraft({...value,status:status as UserStatus})} options={['invited','active','suspended','deactivated']}/></Field>{update.isError&&<ErrorText error={update.error}/>}<Button className="w-full" disabled={update.isPending} onClick={()=>update.mutate()}>{update.isPending?'Saving…':'Save user'}</Button></div></>}</DialogContent></Dialog>;
}

function RoleSelect({value,onChange,options}:{value:string;onChange:(value:string)=>void;options:string[]}){return <Select onValueChange={onChange} value={value}><SelectTrigger className="w-full capitalize"><SelectValue /></SelectTrigger><SelectContent>{options.map((option)=><SelectItem className="capitalize" key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="block space-y-2"><span className="text-xs font-medium">{label}</span>{children}</label>}
function Status({value}:{value:string}){return <span className="text-xs capitalize text-muted-foreground">{value}</span>}
function State({text}:{text:string}){return <p className="px-4 py-12 text-center text-xs text-muted-foreground">{text}</p>}
function ErrorText({error}:{error:unknown}){return <p className="text-xs text-destructive">{error instanceof Error?error.message:'Request failed.'}</p>}
