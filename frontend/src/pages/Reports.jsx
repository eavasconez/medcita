import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../App';
import Layout from '../components/Layout';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  PieChart,
  Pie
} from 'recharts';
import { TrendingUp, Users, Calendar, Award, FileBarChart } from 'lucide-react';

const Reports = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const { token } = useContext(AuthContext);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  useEffect(() => {
    const fetchReport = async () => {
      try {
        setLoading(true);
        const res = await axios.get('http://localhost:5000/api/admin/reports/appointments-by-doctor', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setData(res.data);
      } catch (err) {
        console.error('Error fetching report:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [token]);

  const totalAppointments = data.reduce((acc, curr) => acc + curr.appointments, 0);
  const topDoctor = [...data].sort((a, b) => b.appointments - a.appointments)[0];

  return (
    <Layout>
      <div className="p-8 max-w-7xl mx-auto">
        <header className="mb-10">
          <h2 className="text-4xl font-black text-secondary tracking-tighter">Clinical Analytics</h2>
          <p className="text-slate-500 font-medium text-lg">Performance reports and appointment distribution</p>
        </header>

        {loading ? (
          <div className="h-96 flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-50 flex items-center gap-6 group">
                <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all duration-500">
                  <Calendar size={32} />
                </div>
                <div>
                  <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-1">Total Volume</p>
                  <h3 className="text-4xl font-black text-secondary">{totalAppointments} <span className="text-sm font-medium text-slate-400 italic">citas</span></h3>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-50 flex items-center gap-6 group">
                <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center text-green-500 group-hover:bg-green-500 group-hover:text-white transition-all duration-500">
                  <Award size={32} />
                </div>
                <div>
                  <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-1">Top Performer</p>
                  <h3 className="text-2xl font-black text-secondary truncate max-w-[150px]">{topDoctor?.doctor || '---'}</h3>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-50 flex items-center gap-6 group">
                <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-500 group-hover:bg-orange-500 group-hover:text-white transition-all duration-500">
                  <TrendingUp size={32} />
                </div>
                <div>
                  <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-1">Doctors Active</p>
                  <h3 className="text-4xl font-black text-secondary">{data.length}</h3>
                </div>
              </div>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Bar Chart */}
              <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="flex items-center gap-4 mb-10">
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-primary">
                    <FileBarChart size={24} />
                  </div>
                  <div>
                    <h4 className="text-xl font-black text-secondary">Appointments by Doctor</h4>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-0.5">Quantity across the clinic</p>
                  </div>
                </div>

                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="doctor" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#64748b', fontWeight: 'bold', fontSize: 12 }}
                        angle={-45}
                        textAnchor="end"
                      />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontWeight: 'bold', fontSize: 12 }} />
                      <Tooltip 
                        cursor={{ fill: '#f8fafc' }}
                        contentStyle={{ 
                          borderRadius: '20px', 
                          border: 'none', 
                          boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
                          padding: '15px'
                        }}
                      />
                      <Bar dataKey="appointments" radius={[10, 10, 0, 0]} barSize={40}>
                        {data.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Pie Chart */}
              <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                <div className="flex items-center gap-4 mb-10">
                  <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center text-green-500">
                    <Users size={24} />
                  </div>
                  <div>
                    <h4 className="text-xl font-black text-secondary">Client Distribution</h4>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-0.5">Percentage of load share</p>
                  </div>
                </div>

                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data}
                        cx="50%"
                        cy="45%"
                        innerRadius={80}
                        outerRadius={120}
                        paddingAngle={8}
                        dataKey="appointments"
                        nameKey="doctor"
                      >
                        {data.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '20px', 
                          border: 'none', 
                          boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
                          padding: '15px'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Custom Legend */}
                <div className="grid grid-cols-2 gap-4 mt-2">
                  {data.map((entry, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                      <span className="text-xs font-bold text-slate-600 truncate">{entry.doctor}</span>
                      <span className="text-xs font-black text-slate-400 ml-auto">{Math.round((entry.appointments / totalAppointments) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Reports;
