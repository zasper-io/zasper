import { atom } from 'jotai'

export const userLoggedInAtom = atom(false)

export const userDetails = atom({
  userName: 'Prasun'
})
interface IProject {
  _id: string
  name: string
  total: number
  running: number
  completed: number
  last_activity: string
}

export const projectsAtom = atom<IProject[]>([])

export const secretsAtom = atom<string[]>([])

interface IUser {
  name: string
  email: string
  role: string
  _id: string
}
export const usersAtom = atom<IUser[]>([])

interface Key {
  name: string
  added_on: string
  _id: string
  value: string
}
export const keysAtom = atom<Key[]>([])

interface ITeam {
  name: string
  _id: string
}
export const teamsAtom = atom<ITeam[]>([])

export const teamMembersAtom = atom([])
