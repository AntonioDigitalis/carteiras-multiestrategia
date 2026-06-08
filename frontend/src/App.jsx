import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import CarteiraIndividual from './pages/CarteiraIndividual'
import GestãoDados from './pages/GestãoDados'
import Auditoria from './pages/Auditoria'
import Comparador from './pages/Comparador'
import Configurações from './pages/Configurações'
import OtimizadorLivre from './pages/OtimizadorLivre'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="carteira/:id" element={<CarteiraIndividual />} />
          <Route path="gestao" element={<GestãoDados />} />
          <Route path="auditoria" element={<Auditoria />} />
          <Route path="comparador" element={<Comparador />} />
          <Route path="configuracoes" element={<Configurações />} />
          <Route path="otimizador" element={<OtimizadorLivre />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
